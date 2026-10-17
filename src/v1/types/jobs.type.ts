export type JobType = "index_document" | "answer_question";

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface Job {
    id: string;
    type: JobType;
    status: JobStatus;
    documentId: string;
    error: string | null;
    // 1 = the next queued job to run; null when the job is not waiting
    queuePosition: number | null;
    // chunks that already have their embedding, out of the document's total
    progress: { done: number; total: number };
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
}

// an indexing job the queue has taken and marked as processing
export interface ClaimedJob {
    id: string;
    userId: string;
    documentId: string;
}

// events the job queue sends to its observers (database, log, SSE stream)
export type JobEvent =
    | { type: "queued"; jobId: string; userId: string; position: number }
    | { type: "started"; jobId: string; userId: string }
    | { type: "progress"; jobId: string; userId: string; done: number; total: number }
    | { type: "done"; jobId: string; userId: string; documentId: string }
    | { type: "failed"; jobId: string; userId: string; error: string };
