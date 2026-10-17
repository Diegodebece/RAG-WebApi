import { pool } from "../config/db.config.js";
import { DOCUMENT_LIFETIME_HOURS, QUESTION_USAGE_RETENTION_HOURS } from "../config/limits.config.js";

export interface CleanupResult {
    documents: number;
    questionUsage: number;
}

// Run on a timer by server.ts. Expired documents take their chunks and jobs with them (ON DELETE CASCADE);
// question records are only needed for the daily quota. A future daily_stats table must never be cleaned here.
export const deleteExpiredDataService = async (): Promise<CleanupResult> => {
    const documents = await pool.query(
        "DELETE FROM documents WHERE created_at < now() - make_interval(hours => $1)",
        [DOCUMENT_LIFETIME_HOURS]
    );
    const questionUsage = await pool.query(
        "DELETE FROM question_usage WHERE asked_at < now() - make_interval(hours => $1)",
        [QUESTION_USAGE_RETENTION_HOURS]
    );

    return { documents: documents.rowCount ?? 0, questionUsage: questionUsage.rowCount ?? 0 };
};
