import { pool, withTransaction } from "../config/db.config.js";
import { DOCUMENT_LIFETIME_HOURS, MAX_DOCUMENTS_PER_USER, MAX_QUEUED_JOBS } from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import { chunkText } from "../utils/chunkText.util.js";
import { sanitizeText } from "../utils/sanitizeText.util.js";
import { isUuid } from "../utils/uuid.util.js";
import type { CreatedDocument, Document } from "../types/documents.type.js";
import type { CreateDocumentInput } from "../validators/documents.validator.js";

type DocumentRow = Omit<Document, "expiresAt">;

const DOCUMENT_COLUMNS = `id, filename, status, chunk_count AS "chunkCount", created_at AS "createdAt"`;

const NOT_FOUND_MESSAGE = "Document not found";

const HOUR_MS = 60 * 60 * 1000;

const withExpiry = (row: DocumentRow): Document => ({
    ...row,
    expiresAt: new Date(row.createdAt.getTime() + DOCUMENT_LIFETIME_HOURS * HOUR_MS)
});

// Stores the cleaned text as chunks without embeddings, plus the job that will compute them. The original
// text is never stored. Responds before indexing, which runs in the background.
export const createDocumentService = async (userId: string, documentData: CreateDocumentInput): Promise<CreatedDocument> => {
    const text = sanitizeText(documentData.text);

    if (text === "") {
        throw new AppError(400, "The document has no readable text");
    }

    const chunks = chunkText(text);

    return withTransaction(async (client) => {
        // Locks the user's row until the transaction ends, so two uploads from one user run one after the
        // other and cannot both pass the checks below. No row means the token outlived its account.
        const { rows: users } = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

        if (users.length === 0) {
            throw new AppError(404, "User not found");
        }

        const { rows: [usage] } = await client.query<{ documents: number; activeJobs: number; queuedJobs: number }>(
            `SELECT
                 (SELECT count(*)::int FROM documents WHERE user_id = $1) AS documents,
                 (SELECT count(*)::int FROM jobs
                  WHERE user_id = $1 AND type = 'index_document' AND status IN ('queued', 'processing')) AS "activeJobs",
                 (SELECT count(*)::int FROM jobs WHERE status IN ('queued', 'processing')) AS "queuedJobs"`,
            [userId]
        );

        if (usage.documents >= MAX_DOCUMENTS_PER_USER) {
            throw new AppError(409, `Document limit reached (${MAX_DOCUMENTS_PER_USER}): delete a document to upload another`);
        }

        if (usage.activeJobs > 0) {
            throw new AppError(409, "Another of your documents is still being indexed; try again when it finishes");
        }

        if (usage.queuedJobs >= MAX_QUEUED_JOBS) {
            throw new AppError(503, "The server is busy, please try again in a few minutes");
        }

        const { rows: [row] } = await client.query<DocumentRow>(
            `INSERT INTO documents (user_id, filename, chunk_count) VALUES ($1, $2, $3) RETURNING ${DOCUMENT_COLUMNS}`,
            [userId, documentData.filename, chunks.length]
        );

        // one INSERT for all chunks, numbered from 0 in text order
        await client.query(
            `INSERT INTO chunks (document_id, chunk_index, text)
             SELECT $1, position - 1, chunk FROM unnest($2::text[]) WITH ORDINALITY AS t(chunk, position)`,
            [row.id, chunks]
        );

        const { rows: [job] } = await client.query<{ id: string }>(
            "INSERT INTO jobs (user_id, document_id, type) VALUES ($1, $2, 'index_document') RETURNING id",
            [userId, row.id]
        );

        return { document: withExpiry(row), jobId: job.id };
    });
};

export const getDocumentsService = async (userId: string): Promise<Document[]> => {
    const { rows } = await pool.query<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId]
    );
    return rows.map(withExpiry);
};

export const getDocumentByIdService = async (userId: string, id: string): Promise<Document> => {
    if (!isUuid(id)) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }

    const { rows } = await pool.query<DocumentRow>(
        `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = $1 AND user_id = $2`,
        [id, userId]
    );

    if (rows.length === 0) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }

    return withExpiry(rows[0]);
};

// Its chunks and jobs are deleted with it (ON DELETE CASCADE).
export const deleteDocumentService = async (userId: string, id: string): Promise<void> => {
    if (!isUuid(id)) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }

    const { rows } = await pool.query("DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id", [id, userId]);

    if (rows.length === 0) {
        throw new AppError(404, NOT_FOUND_MESSAGE);
    }
};
