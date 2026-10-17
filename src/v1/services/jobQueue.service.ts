import { pool } from "../config/db.config.js";
import { runIndexingJobService } from "./indexing.service.js";
import type { ClaimedJob } from "../types/jobs.type.js";

// how often the worker looks for queued jobs it was not told about (for example after Ollama was down)
const POLL_INTERVAL_MS = 10_000;

// Takes the oldest queued indexing job and marks it as processing. SKIP LOCKED keeps two workers
// (if there ever were two) from taking the same job.
const claimNextJob = async (): Promise<ClaimedJob | null> => {
    const { rows } = await pool.query<ClaimedJob>(
        `UPDATE jobs SET status = 'processing', started_at = now()
         WHERE id = (
             SELECT id FROM jobs WHERE status = 'queued' AND type = 'index_document'
             ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, user_id AS "userId", document_id AS "documentId"`
    );
    return rows[0] ?? null;
};

let draining: Promise<void> | null = null;
let workerStarted = false;
let pollTimer: NodeJS.Timeout | null = null;

// Runs queued jobs one at a time until the queue is empty or Ollama is unreachable. Calls made while it
// runs share the same run, so a job is never processed twice in parallel.
export const processQueuedJobsService = async (): Promise<void> => {
    if (draining) {
        return draining;
    }

    draining = (async () => {
        try {
            while (true) {
                const job = await claimNextJob();

                if (!job || (await runIndexingJobService(job)) === "requeued") {
                    return;
                }
            }
        } finally {
            draining = null;
        }
    })();

    return draining;
};

// The queue runs in the background: an error (for example the database going away) is logged, the job
// stays as it was, and the next poll or the next restart picks it up again.
const runQueueInBackground = async (): Promise<void> => {
    try {
        await processQueuedJobsService();
    } catch (error) {
        console.error("The job queue stopped", error);
    }
};

// Called after an upload. Does nothing until the worker is started (by server.ts), so tests and scripts
// that import the app never start indexing on their own.
export const notifyJobQueuedService = (): void => {
    if (workerStarted) {
        void runQueueInBackground();
    }
};

export const startJobWorkerService = (): void => {
    workerStarted = true;
    notifyJobQueuedService();
    pollTimer = setInterval(notifyJobQueuedService, POLL_INTERVAL_MS);
};

export const stopJobWorkerService = (): void => {
    workerStarted = false;

    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
};

// Run once at startup, before the worker: a job that was processing when the API stopped goes back to
// the queue (its stored vectors are kept), and its document back to pending.
export const recoverJobsService = async (): Promise<number> => {
    const { rowCount } = await pool.query(
        "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'processing' AND type = 'index_document'"
    );
    await pool.query("UPDATE documents SET status = 'pending' WHERE status = 'indexing'");
    return rowCount ?? 0;
};
