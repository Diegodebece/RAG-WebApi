export type JobType = "index_document" | "answer_question";

export type JobStatus = "queued" | "processing" | "done" | "failed";

// events the job queue sends to its observers (database, log, SSE stream)
export type JobEvent =
    | { type: "queued"; jobId: string; userId: string; position: number }
    | { type: "started"; jobId: string; userId: string }
    | { type: "progress"; jobId: string; userId: string; done: number; total: number }
    | { type: "done"; jobId: string; userId: string; documentId: string }
    | { type: "failed"; jobId: string; userId: string; error: string };
