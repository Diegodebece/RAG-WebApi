// pending: stored, waiting for its embeddings; indexing: the job is computing them;
// ready: questions can be asked; failed: indexing stopped with an error
export type DocumentStatus = "pending" | "indexing" | "ready" | "failed";

export interface Document {
    id: string;
    filename: string;
    status: DocumentStatus;
    chunkCount: number;
    createdAt: Date;
    // when the cleanup task deletes it
    expiresAt: Date;
}

// returned by POST /documents: the stored document and the job that will index it
export interface CreatedDocument {
    document: Document;
    jobId: string;
}
