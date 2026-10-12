import type { Fragment } from "../types/answers.type.js";
import { hasValidCitations } from "./citations.util.js";
import { INSUFFICIENT_EVIDENCE_ANSWER } from "./prompts.util.js";

interface StructuredDecision {
    answerable: boolean;
    answer: string;
}

const isStructuredDecision = (value: unknown): value is StructuredDecision =>
    typeof value === "object" && value !== null
    && "answerable" in value && typeof value.answerable === "boolean"
    && "answer" in value && typeof value.answer === "string";

// Turns the model's raw structured-mode reply into the final answer text, like RAG1's baseline-structured variant:
// "answerable: false" becomes the fallback sentence. Throws when the reply breaks the contract
// (invalid JSON, wrong shape, empty answer, missing or invented citations); the caller decides how to report it.
export const interpretStructuredAnswer = (raw: string, fragments: Fragment[]): string => {
    let decision: unknown;

    try {
        decision = JSON.parse(raw);
    } catch {
        throw new Error("The model returned invalid JSON for the structured answer");
    }

    if (!isStructuredDecision(decision)) {
        throw new Error("The model must return an answerable boolean and an answer string");
    }

    if (!decision.answerable) {
        return INSUFFICIENT_EVIDENCE_ANSWER;
    }

    const answer = decision.answer.trim();

    if (answer === "" || answer === INSUFFICIENT_EVIDENCE_ANSWER) {
        throw new Error("An answerable structured response must contain an answer");
    }

    if (!hasValidCitations(answer, fragments)) {
        throw new Error("The structured answer must cite only provided chunk ids");
    }

    return answer;
};
