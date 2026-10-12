export type AnswerMode = "baseline" | "structured";

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
