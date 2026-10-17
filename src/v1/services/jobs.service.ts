import { pool } from "../config/db.config.js";
import { AppError } from "../utils/appError.util.js";
import { isUuid } from "../utils/uuid.util.js";
import type { Job } from "../types/jobs.type.js";

const NOT_FOUND_MESSAGE = "Job not found";

// queuePosition counts the queued jobs of every user created before this one, plus itself: 1 means it runs
// next. Ties on created_at are broken by id, so two jobs never share a position.
export const getJobByIdService = async (userId: string, id: string): Promise<Job> => {
    if (!isUuid(id)) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }

    const { rows } = await pool.query<Job>(
        `SELECT j.id, j.type, j.status, j.document_id AS "documentId", j.error,
                CASE WHEN j.status = 'queued' THEN (
                    SELECT count(*)::int FROM jobs q
                    WHERE q.status = 'queued' AND q.type = 'index_document' AND (q.created_at, q.id) <= (j.created_at, j.id)
                ) END AS "queuePosition",
                json_build_object(
                    'done', (SELECT count(*)::int FROM chunks c WHERE c.document_id = j.document_id AND c.embedding IS NOT NULL),
                    'total', d.chunk_count
                ) AS progress,
                j.created_at AS "createdAt", j.started_at AS "startedAt", j.finished_at AS "finishedAt"
         FROM jobs j
         JOIN documents d ON d.id = j.document_id
         WHERE j.id = $1 AND j.user_id = $2`,
        [id, userId]
    );

    if (rows.length === 0) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }

    return rows[0];
};
