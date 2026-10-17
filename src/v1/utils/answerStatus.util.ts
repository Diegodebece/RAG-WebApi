import type { AnswerStatus } from "../types/answers.type.js";
import { INSUFFICIENT_EVIDENCE_ANSWERS } from "./prompts.util.js";

const FALLBACK_SENTENCES = new Set(Object.values(INSUFFICIENT_EVIDENCE_ANSWERS));

// The exact fallback sentence of any supported language, also when the model wraps it in straight,
// curly or angle quotes. Any language is accepted because a model asked in Spanish may still reply
// with the English sentence; the sentences are exact, so this cannot misread a real answer.
export const isInsufficientEvidenceAnswer = (answer: string): boolean =>
    FALLBACK_SENTENCES.has(answer.trim().replace(/^["“«](.*)["”»]$/s, "$1"));

// no_match: retrieval found no chunk above the minimum score, so the model was never asked (answer is ignored).
// insufficient_evidence: the model was asked and replied with a fallback sentence.
export const decideAnswerStatus = (matchCount: number, answer: string): AnswerStatus => {
    if (matchCount === 0) {
        return "no_match";
    }

    return isInsufficientEvidenceAnswer(answer) ? "insufficient_evidence" : "answered";
};
