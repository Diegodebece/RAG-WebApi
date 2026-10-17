import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpretStructuredAnswer } from "../../src/v1/utils/structuredAnswer.util.js";
import { INSUFFICIENT_EVIDENCE_ANSWERS } from "../../src/v1/utils/prompts.util.js";
import type { Fragment } from "../../src/v1/types/answers.type.js";

const fragments: Fragment[] = [
    { id: "F1", chunkIndex: 0, text: "Holmes lived at 221B Baker Street.", retrieval: "match", score: 0.8 },
    { id: "F2", chunkIndex: 1, text: "Watson shared the rooms.", retrieval: "neighbor" }
];

const reply = (value: unknown): string => JSON.stringify(value);

describe("interpretStructuredAnswer", () => {
    it("returns the trimmed answer when it is answerable and correctly cited", () => {
        const answer = interpretStructuredAnswer(reply({ answerable: true, answer: "  221B Baker Street [F1].  " }), fragments);

        assert.equal(answer, "221B Baker Street [F1].");
    });

    it("returns the fallback sentence when the model says it is not answerable", () => {
        assert.equal(interpretStructuredAnswer(reply({ answerable: false, answer: "" }), fragments), INSUFFICIENT_EVIDENCE_ANSWERS.en);
    });

    it("returns the fallback sentence in the requested language", () => {
        assert.equal(
            interpretStructuredAnswer(reply({ answerable: false, answer: "" }), fragments, "es"),
            INSUFFICIENT_EVIDENCE_ANSWERS.es
        );
    });

    it("returns a Spanish answer that is correctly cited", () => {
        const answer = interpretStructuredAnswer(reply({ answerable: true, answer: "En el 221B de Baker Street [F1]." }), fragments, "es");

        assert.equal(answer, "En el 221B de Baker Street [F1].");
    });

    it("throws when an answerable reply is a fallback sentence of any language", () => {
        assert.throws(
            () => interpretStructuredAnswer(reply({ answerable: true, answer: INSUFFICIENT_EVIDENCE_ANSWERS.es }), fragments, "en"),
            /must contain an answer/
        );
    });

    it("throws on a reply that is not JSON", () => {
        assert.throws(() => interpretStructuredAnswer("Baker Street [F1]", fragments), /invalid JSON/);
    });

    it("throws when fields are missing or have the wrong type", () => {
        assert.throws(() => interpretStructuredAnswer(reply({ answer: "x [F1]" }), fragments), /answerable boolean/);
        assert.throws(() => interpretStructuredAnswer(reply({ answerable: "yes", answer: "x [F1]" }), fragments), /answerable boolean/);
        assert.throws(() => interpretStructuredAnswer(reply(null), fragments), /answerable boolean/);
    });

    it("throws when an answerable reply is empty or is the fallback sentence", () => {
        assert.throws(() => interpretStructuredAnswer(reply({ answerable: true, answer: "  " }), fragments), /must contain an answer/);
        assert.throws(
            () => interpretStructuredAnswer(reply({ answerable: true, answer: INSUFFICIENT_EVIDENCE_ANSWERS.en }), fragments),
            /must contain an answer/
        );
    });

    it("accepts an F-term quoted from the document, such as a key name", () => {
        const keyFragments: Fragment[] = [{ id: "F1", chunkIndex: 0, text: "Press F5 to refresh the page.", retrieval: "match", score: 0.9 }];
        const answer = interpretStructuredAnswer(reply({ answerable: true, answer: "Press F5 to refresh the page [F1]." }), keyFragments);

        assert.equal(answer, "Press F5 to refresh the page [F1].");
    });

    it("throws when citations are missing or invented", () => {
        assert.throws(() => interpretStructuredAnswer(reply({ answerable: true, answer: "Baker Street." }), fragments), /cite only/);
        assert.throws(() => interpretStructuredAnswer(reply({ answerable: true, answer: "Baker Street [F5]." }), fragments), /cite only/);
    });
});
