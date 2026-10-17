// Where Ollama listens: localhost during development, host.docker.internal once the API runs in Docker.
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// The models RAG1 was evaluated with; changing the embedding model requires re-indexing every document.
export const ANSWER_MODEL = "qwen3.5:4b";

export const EMBEDDING_MODEL = "qwen3-embedding:0.6b";
