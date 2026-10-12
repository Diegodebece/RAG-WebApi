import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideAnswerStatus, isInsufficientEvidenceAnswer } from "../../src/v1/utils/answerStatus.util.js";
import { INSUFFICIENT_EVIDENCE_ANSWER } from "../../src/v1/utils/prompts.util.js";

describe("isInsufficientEvidenceAnswer", () => {
    it("recognizes the exact fallback sentence, also with surrounding whitespace", () => {
        assert.equal(isInsufficientEvidenceAnswer(INSUFFICIENT_EVIDENCE_ANSWER), true);
        assert.equal(isInsufficientEvidenceAnswer(`  ${INSUFFICIENT_EVIDENCE_ANSWER}\n`), true);
    });

    it("recognizes the fallback sentence wrapped in straight or curly quotes", () => {
        assert.equal(isInsufficientEvidenceAnswer(`"${INSUFFICIENT_EVIDENCE_ANSWER}"`), true);
        assert.equal(isInsufficientEvidenceAnswer(`“${INSUFFICIENT_EVIDENCE_ANSWER}”`), true);
    });

    it("does not treat an answer that only contains the sentence as a fallback", () => {
        assert.equal(isInsufficientEvidenceAnswer(`Maybe. ${INSUFFICIENT_EVIDENCE_ANSWER}`), false);
        assert.equal(isInsufficientEvidenceAnswer("I cannot find enough information."), false);
    });
});

describe("decideAnswerStatus", () => {
    it("is no_match when retrieval found nothing, whatever the answer", () => {
        assert.equal(decideAnswerStatus(0, ""), "no_match");
        assert.equal(decideAnswerStatus(0, "Baker Street [F1]."), "no_match");
    });

    it("is insufficient_evidence when the model replied with the fallback sentence", () => {
        assert.equal(decideAnswerStatus(3, INSUFFICIENT_EVIDENCE_ANSWER), "insufficient_evidence");
    });

    it("is answered otherwise", () => {
        assert.equal(decideAnswerStatus(3, "221B Baker Street [F1]."), "answered");
    });
});
