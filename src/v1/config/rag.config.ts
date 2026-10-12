// Values measured in RAG1's 100-question evaluation (75/100 baseline, 72/100 structured).
// Changing CHUNK_MAX_CHARS or EMBEDDING_DIMENSIONS requires re-indexing every document.

export const CHUNK_MAX_CHARS = 1000;

export const RETRIEVAL_TOP_K = 3;

export const RETRIEVAL_MIN_SCORE = 0.3;

// qwen3-embedding:0.6b; must match the vector(1024) column
export const EMBEDDING_DIMENSIONS = 1024;

export const OLLAMA_OPTIONS = {
    temperature: 0,
    seed: 42,
    num_ctx: 8192
} as const;
