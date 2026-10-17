import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractCitationIds, hasValidCitations } from "../../src/v1/utils/citations.util.js";
import type { Fragment } from "../../src/v1/types/answers.type.js";

const fragment = (id: string, text: string): Fragment => ({ id, chunkIndex: 0, text, retrieval: "match", score: 0.8 });

const fragments: Fragment[] = [
    fragment("F1", "Press F5 to refresh the page."),
    fragment("F2", "The settings menu is under the gear icon."),
    fragment("F3", "Changes are saved automatically.")
];

describe("extractCitationIds", () => {
    it("returns cited ids in order of first appearance, without duplicates", () => {
        assert.deepEqual(extractCitationIds("A [F2]. B [F1][F2]. C [F10]."), ["F2", "F1", "F10"]);
    });

    it("reads lists of ids inside one pair of brackets", () => {
        assert.deepEqual(extractCitationIds("A [F1, F2]. B [F3; F1]. C [ F4 ]."), ["F1", "F2", "F3", "F4"]);
    });

    it("ignores ids that are not in brackets", () => {
        assert.deepEqual(extractCitationIds("See F1 and (F2)."), []);
    });

    it("ignores brackets that hold anything besides ids", () => {
        assert.deepEqual(extractCitationIds("Press [F5 key] or [see F2]."), []);
    });

    it("returns nothing for an answer without citations", () => {
        assert.deepEqual(extractCitationIds("No citations here."), []);
    });
});

describe("citation parsing on hostile input", () => {
    // guards against regular expressions whose running time explodes on crafted text (ReDoS)
    it("handles 200,000 characters of near-citations in well under a second", () => {
        const started = performance.now();

        extractCitationIds(`[F1${", F1".repeat(50000)}`);
        hasValidCitations("[F1 ".repeat(50000), fragments);

        assert.ok(performance.now() - started < 1000);
    });
});

describe("hasValidCitations", () => {
    it("accepts an answer whose citations were all provided", () => {
        assert.equal(hasValidCitations("Open the gear icon [F2]; changes save themselves [F3].", fragments), true);
    });

    it("accepts a list citation", () => {
        assert.equal(hasValidCitations("Open the gear icon; changes save themselves [F2, F3].", fragments), true);
    });

    it("rejects an answer without any citation", () => {
        assert.equal(hasValidCitations("Open the gear icon.", fragments), false);
    });

    it("rejects an invented citation id, alone or inside a list", () => {
        assert.equal(hasValidCitations("Open the gear icon [F2] [F7].", fragments), false);
        assert.equal(hasValidCitations("Open the gear icon [F2, F7].", fragments), false);
    });

    it("accepts an F-term from the document, such as a key name, next to a valid citation", () => {
        assert.equal(hasValidCitations("Press F5 to refresh the page [F1].", fragments), true);
    });

    it("accepts a known id mentioned without brackets", () => {
        assert.equal(hasValidCitations("As F2 says, open the gear icon [F2].", fragments), true);
    });

    it("rejects an unknown id outside brackets that does not appear in the document", () => {
        assert.equal(hasValidCitations("Open the gear icon [F2], see also F9.", fragments), false);
    });
});
