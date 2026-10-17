import { EMBEDDING_DIMENSIONS } from "../config/rag.config.js";
import { EMBEDDING_MODEL, OLLAMA_BASE_URL } from "../config/ollama.config.js";
import { AppError } from "../utils/appError.util.js";
import { ModelUnavailableError } from "../utils/modelUnavailableError.util.js";

// RAG1 used the same limit for one request; a batch of chunks takes far less on the laptop's GPU
const REQUEST_TIMEOUT_MS = 120_000;

const isVector = (value: unknown): value is number[] =>
    Array.isArray(value)
    && value.length === EMBEDDING_DIMENSIONS
    && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));

// Embeds several texts in one request; the vectors come back in the same order as the texts.
// Expected failures are AppErrors with messages that are safe to show: ModelUnavailableError (503) when
// Ollama cannot be reached (the caller may retry later), 504 when it does not answer in time. Any malformed answer is a plain
// Error, because it means a model or version mismatch that retrying will not fix.
export const embedTextsService = async (texts: string[]): Promise<number[][]> => {
    let response: Response;

    try {
        response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // truncate: false makes Ollama fail instead of silently embedding only part of a long text
            body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, truncate: false }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
    } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
            throw new AppError(504, "The model server did not answer in time");
        }
        throw new ModelUnavailableError();
    }

    if (!response.ok) {
        throw new Error(`Ollama answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const body: unknown = await response.json();
    const embeddings = typeof body === "object" && body !== null && "embeddings" in body ? body.embeddings : undefined;

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length || !embeddings.every(isVector)) {
        throw new Error(`Ollama must return ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} finite numbers`);
    }

    return embeddings;
};
