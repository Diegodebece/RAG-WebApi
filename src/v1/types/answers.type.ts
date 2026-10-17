export type AnswerMode = "baseline" | "structured";

// language of the instructions and the answer; only "en" was evaluated in RAG1
export type AnswerLanguage = "en" | "es";

export type AnswerStatus = "answered" | "insufficient_evidence" | "no_match";

// a chunk placed in the prompt, cited by the model as [F1], [F2], ...
export interface Fragment {
    id: string;
    chunkIndex: number;
    text: string;
    retrieval: "match" | "neighbor";
    score?: number;
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

// a fragment as the API returns it; chunkNumber is 1-based, as the model sees it
export interface AnswerSource {
    id: string;
    chunkNumber: number;
    text: string;
    retrieval: "match" | "neighbor";
    score?: number;
}

// milliseconds spent in each step of a question; waitMs is the time waiting for the turn with the model
export interface AnswerTimings {
    waitMs: number;
    embeddingMs: number;
    retrievalMs: number;
    answerMs: number;
    totalMs: number;
}

// POST /documents/:id/ask
export interface QuestionAnswer {
    status: AnswerStatus;
    answer: string;
    citations: string[];
    sources: AnswerSource[];
    timings: AnswerTimings;
}
