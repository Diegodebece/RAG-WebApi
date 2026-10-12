// a chunk's position in its document and its text, without the embedding
export interface ChunkText {
    chunkIndex: number;
    text: string;
}

// a chunk returned by similarity search; score is the cosine similarity (-1 to 1)
export interface ScoredChunk extends ChunkText {
    score: number;
}
