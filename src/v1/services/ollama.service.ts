import { EMBEDDING_DIMENSIONS, OLLAMA_OPTIONS } from "../config/rag.config.js";
import { ANSWER_MODEL, EMBEDDING_MODEL, OLLAMA_BASE_URL, OLLAMA_TIMEOUT_MS } from "../config/ollama.config.js";
import { AppError } from "../utils/appError.util.js";
import { ModelUnavailableError } from "../utils/modelUnavailableError.util.js";
import { RequestCancelledError } from "../utils/requestCancelledError.util.js";
import type { ChatMessage } from "../types/answers.type.js";

interface ChatOptions {
    // "json" makes Ollama return valid JSON (structured mode)
    format?: "json";
    // aborts the request when the caller no longer needs the answer
    signal?: AbortSignal;
}

const isVector = (value: unknown): value is number[] =>
    Array.isArray(value)
    && value.length === EMBEDDING_DIMENSIONS
    && value.every((item: unknown) => typeof item === "number" && Number.isFinite(item));

// Sends one request to Ollama and returns its JSON body. Expected failures are AppErrors with messages that
// are safe to show: ModelUnavailableError (503) when Ollama cannot be reached (the caller may retry later),
// 504 when it does not answer in time. A non-OK answer is a plain Error: it means a model or version
// mismatch that retrying will not fix.
const postToOllama = async (path: string, body: object, signal?: AbortSignal): Promise<unknown> => {
    const timeout = AbortSignal.timeout(OLLAMA_TIMEOUT_MS);

    try {
        const response = await fetch(`${OLLAMA_BASE_URL}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout
        });

        if (!response.ok) {
            throw new Error(`Ollama answered HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }

        return await response.json();
    } catch (error) {
        if (timeout.aborted) {
            throw new AppError(504, "The model server did not answer in time");
        }

        if (signal?.aborted) {
            throw new RequestCancelledError();
        }

        // fetch rejects with a TypeError when the connection fails; anything else is not a connection problem
        if (error instanceof TypeError) {
            throw new ModelUnavailableError();
        }

        throw error;
    }
};

// Embeds several texts in one request; the vectors come back in the same order as the texts.
// A malformed answer is a plain Error, for the same reason as a non-OK one.
export const embedTextsService = async (texts: string[]): Promise<number[][]> => {
    // truncate: false makes Ollama fail instead of silently embedding only part of a long text
    const body = await postToOllama("/api/embed", { model: EMBEDDING_MODEL, input: texts, truncate: false });
    const embeddings = typeof body === "object" && body !== null && "embeddings" in body ? body.embeddings : undefined;

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length || !embeddings.every(isVector)) {
        throw new Error(`Ollama must return ${texts.length} vectors of ${EMBEDDING_DIMENSIONS} finite numbers`);
    }

    return embeddings;
};

// Loads both models into Ollama's memory so the first real request does not wait for them. An empty chat
// request loads the answer model without generating anything; it uses the same options as real requests,
// because another context size would make Ollama load the model again.
export const loadModelsService = async (): Promise<void> => {
    await postToOllama("/api/embed", { model: EMBEDDING_MODEL, input: ["warm up"], truncate: false });
    await postToOllama("/api/chat", { model: ANSWER_MODEL, messages: [], options: OLLAMA_OPTIONS });
};

// Asks the answer model and returns its reply, with the options RAG1 was evaluated with (temperature 0,
// fixed seed, 8,192-token context) and thinking off. The whole reply comes at once (no streaming).
export const chatService = async (messages: ChatMessage[], options: ChatOptions = {}): Promise<string> => {
    const body = await postToOllama("/api/chat", {
        model: ANSWER_MODEL,
        messages,
        stream: false,
        think: false,
        options: OLLAMA_OPTIONS,
        ...(options.format ? { format: options.format } : {})
    }, options.signal);
    const message = typeof body === "object" && body !== null && "message" in body ? body.message : undefined;
    const content = typeof message === "object" && message !== null && "content" in message ? message.content : undefined;

    if (typeof content !== "string" || content.trim() === "") {
        throw new Error("Ollama returned no answer text");
    }

    return content.trim();
};
