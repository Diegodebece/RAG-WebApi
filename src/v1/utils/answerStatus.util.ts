import type { AnswerStatus } from "../types/answers.type.js";
import { INSUFFICIENT_EVIDENCE_ANSWER } from "./prompts.util.js";

// The exact fallback sentence, also when the model wraps it in straight or curly quotes.
export const isInsufficientEvidenceAnswer = (answer: string): boolean =>
    answer.trim().replace(/^["“](.*)["”]$/s, "$1") === INSUFFICIENT_EVIDENCE_ANSWER;

// no_match: retrieval found no chunk above the minimum score, so the model was never asked (answer is ignored).
// insufficient_evidence: the model was asked and replied with the fallback sentence.
export const decideAnswerStatus = (matchCount: number, answer: string): AnswerStatus => {
    if (matchCount === 0) {
        return "no_match";
    }

    return isInsufficientEvidenceAnswer(answer) ? "insufficient_evidence" : "answered";
};
