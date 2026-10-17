import { pool } from "../config/db.config.js";
import { AppError } from "../utils/appError.util.js";
import { ModelUnavailableError } from "../utils/modelUnavailableError.util.js";
import { emitJobEvent } from "./jobEvents.service.js";
import { runWithModelTurnService } from "./modelTurn.service.js";
import { embedTextsService } from "./ollama.service.js";
import type { ClaimedJob } from "../types/jobs.type.js";

// chunks sent to Ollama per request; progress is reported after each batch (the brief asks for at most every 10)
const EMBEDDING_BATCH_SIZE = 10;

const FAILED_MESSAGE = "Indexing failed";

// Embeds the chunks that still have no vector, batch by batch, so a restarted job continues where it stopped.
// Returns false when the document was deleted meanwhile (its job row went with it).
const embedDocument = async (job: ClaimedJob): Promise<boolean> => {
    const { rows: documents } = await pool.query<{ total: number }>(
        "UPDATE documents SET status = 'indexing' WHERE id = $1 RETURNING chunk_count AS total",
        [job.documentId]
    );

    if (documents.length === 0) {
        return false;
    }

    const { total } = documents[0];

    while (true) {
        const { rows: chunks } = await pool.query<{ chunkIndex: number; text: string }>(
            `SELECT chunk_index AS "chunkIndex", text FROM chunks
             WHERE document_id = $1 AND embedding IS NULL ORDER BY chunk_index LIMIT $2`,
            [job.documentId, EMBEDDING_BATCH_SIZE]
        );

        if (chunks.length === 0) {
            return true;
        }

        // one turn with the model per batch, so a question waits for at most one batch, not the whole document
        const embeddings = await runWithModelTurnService(() => embedTextsService(chunks.map((chunk) => chunk.text)));

        // one UPDATE per batch; pgvector reads each vector from its JSON-like text form
        const { rowCount } = await pool.query(
            `UPDATE chunks SET embedding = batch.embedding::vector
             FROM unnest($2::int[], $3::text[]) AS batch(chunk_index, embedding)
             WHERE chunks.document_id = $1 AND chunks.chunk_index = batch.chunk_index`,
            [job.documentId, chunks.map((chunk) => chunk.chunkIndex), embeddings.map((embedding) => JSON.stringify(embedding))]
        );

        if (rowCount === 0) {
            return false;
        }

        const { rows: [remaining] } = await pool.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM chunks WHERE document_id = $1 AND embedding IS NULL",
            [job.documentId]
        );
        emitJobEvent({ type: "progress", jobId: job.id, userId: job.userId, done: total - remaining.count, total });
    }
};

// Runs one indexing job the queue has claimed. "requeued" means the model server was unreachable and the
// job went back to the queue, so the queue should stop until its next round.
export const runIndexingJobService = async (job: ClaimedJob): Promise<"done" | "requeued"> => {
    emitJobEvent({ type: "started", jobId: job.id, userId: job.userId });

    try {
        const stillExists = await embedDocument(job);
        const { rows } = stillExists
            ? await pool.query("UPDATE documents SET status = 'ready' WHERE id = $1 RETURNING id", [job.documentId])
            : { rows: [] };

        // deleted while it was being indexed: nothing to report
        if (rows.length === 0) {
            return "done";
        }

        await pool.query("UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1", [job.id]);
        emitJobEvent({ type: "done", jobId: job.id, userId: job.userId, documentId: job.documentId });
        return "done";
    } catch (error) {
        // Ollama is not running (common right after the laptop starts): the job waits for the next round,
        // keeping the vectors already stored, instead of failing.
        if (error instanceof ModelUnavailableError) {
            await pool.query("UPDATE jobs SET status = 'queued', started_at = NULL WHERE id = $1", [job.id]);
            await pool.query("UPDATE documents SET status = 'pending' WHERE id = $1", [job.documentId]);
            return "requeued";
        }

        // AppError messages are written for users; anything else is logged and reported generically
        const message = error instanceof AppError ? error.message : FAILED_MESSAGE;

        if (!(error instanceof AppError)) {
            console.error(`Job ${job.id} failed`, error);
        }

        await pool.query("UPDATE jobs SET status = 'failed', error = $2, finished_at = now() WHERE id = $1", [job.id, message]);
        await pool.query("UPDATE documents SET status = 'failed' WHERE id = $1", [job.documentId]);
        emitJobEvent({ type: "failed", jobId: job.id, userId: job.userId, error: message });
        return "done";
    }
};
