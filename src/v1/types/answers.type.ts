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
