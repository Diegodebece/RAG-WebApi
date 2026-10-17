import { pool } from "../config/db.config.js";
import { emitEvent } from "./events.service.js";
import { runIndexingJobService } from "./indexing.service.js";
import type { ClaimedJob } from "../types/jobs.type.js";

// how often the worker looks for queued jobs it was not told about (for example after Ollama was down)
const POLL_INTERVAL_MS = 10_000;

// A job that has been "processing" this long without being the one this process runs is stuck. The margin
// covers the moment between claiming a job and starting it.
const STUCK_JOB_SECONDS = 60;

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

// Tells the owner of every queued indexing job its place in line (1 = it runs next), in the order the worker
// takes them. Called whenever the line changes: after an upload, when the worker takes a job, and when a job
// goes back to the queue. There are at most MAX_QUEUED_JOBS of them.
const emitQueuePositions = async (): Promise<void> => {
    const { rows } = await pool.query<{ id: string; userId: string }>(
        `SELECT id, user_id AS "userId" FROM jobs WHERE status = 'queued' AND type = 'index_document' ORDER BY created_at, id`
    );
    rows.forEach((job, index) => emitEvent({ type: "queued", jobId: job.id, userId: job.userId, position: index + 1 }));
};

let draining: Promise<void> | null = null;
let workerStarted = false;
let pollTimer: NodeJS.Timeout | null = null;
// the job this process is running, if any
let currentJobId: string | null = null;

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

                if (!job) {
                    return;
                }

                currentJobId = job.id;

                try {
                    // every job still waiting moved up one place
                    await emitQueuePositions();

                    if ((await runIndexingJobService(job)) === "requeued") {
                        // the job is back at the front of the line
                        await emitQueuePositions();
                        return;
                    }
                } finally {
                    currentJobId = null;
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

const emitQueuePositionsInBackground = async (): Promise<void> => {
    try {
        await emitQueuePositions();
    } catch (error) {
        console.error("Could not send the queue positions", error);
    }
};

// Called after an upload. An idle worker takes the new job at once (and sends the positions itself); while it
// is busy, or before server.ts starts it, the new job waits, so its owner is told its place in line. Tests and
// scripts that import the app never start indexing on their own.
export const notifyJobQueuedService = (): void => {
    if (workerStarted && !draining) {
        void runQueueInBackground();
    } else {
        void emitQueuePositionsInBackground();
    }
};

// An error after a job was claimed (the database failing in the middle, for example) can leave it "processing":
// it would never run again while the API lives, and its owner could not upload anything else. This puts such
// jobs back in the queue, keeping their stored vectors: every processing job that is not the one this process
// runs and that started over a minute ago (one API process runs one job at a time). Returns how many it moved.
export const requeueStuckJobsService = async (): Promise<number> => {
    const { rows } = await pool.query<{ documentId: string }>(
        `UPDATE jobs SET status = 'queued', started_at = NULL
         WHERE status = 'processing' AND type = 'index_document'
           AND id IS DISTINCT FROM $1 AND started_at < now() - make_interval(secs => $2)
         RETURNING document_id AS "documentId"`,
        [currentJobId, STUCK_JOB_SECONDS]
    );

    if (rows.length > 0) {
        await pool.query(
            "UPDATE documents SET status = 'pending' WHERE id = ANY($1::uuid[]) AND status = 'indexing'",
            [rows.map((row) => row.documentId)]
        );
    }

    return rows.length;
};

// Every POLL_INTERVAL_MS: put stuck jobs back, then start the worker if it is idle. Unlike an upload, a poll that
// changed nothing sends no queue positions, so a busy worker does not repeat the same events every 10 seconds.
const pollQueue = async (): Promise<void> => {
    try {
        const requeued = await requeueStuckJobsService();

        if (requeued > 0) {
            console.log(`Requeued ${requeued} stuck indexing job(s)`);
            notifyJobQueuedService();
            return;
        }
    } catch (error) {
        console.error("Could not look for stuck jobs", error);
    }

    if (workerStarted && !draining) {
        void runQueueInBackground();
    }
};

export const startJobWorkerService = (): void => {
    workerStarted = true;
    notifyJobQueuedService();
    pollTimer = setInterval(() => void pollQueue(), POLL_INTERVAL_MS);
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
