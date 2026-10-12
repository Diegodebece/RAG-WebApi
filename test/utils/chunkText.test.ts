import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../../src/v1/utils/chunkText.util.js";

// half of a surrogate pair without its other half, i.e. an emoji cut in two
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("chunkText", () => {
    it("returns no chunks for empty or whitespace-only text", () => {
        assert.deepEqual(chunkText(""), []);
        assert.deepEqual(chunkText(" \n\t "), []);
    });

    it("keeps short text in a single chunk with whitespace collapsed", () => {
        assert.deepEqual(chunkText("  one\n\ntwo\tthree  "), ["one two three"]);
    });

    it("packs whole words without exceeding the limit", () => {
        assert.deepEqual(chunkText("aaa bbb ccc ddd", 7), ["aaa bbb", "ccc ddd"]);
        assert.deepEqual(chunkText("aaa bbb ccc", 8), ["aaa bbb", "ccc"]);
    });

    it("fills a chunk up to exactly the limit", () => {
        assert.deepEqual(chunkText("ab cd ef", 5), ["ab cd", "ef"]);
    });

    it("uses 1,000 characters by default", () => {
        const text = Array.from({ length: 400 }, () => "word").join(" ");
        const chunks = chunkText(text);

        assert.ok(chunks.length > 1);
        assert.ok(chunks.every((chunk) => chunk.length <= 1000));
        assert.equal(chunks.join(" "), text);
    });

    it("cuts a word longer than the limit into pieces instead of failing", () => {
        assert.deepEqual(chunkText("ab abcdefghij cd", 4), ["ab", "abcd", "efgh", "ij", "cd"]);
    });

    it("never splits a surrogate pair when cutting a long word", () => {
        const chunks = chunkText("😀😀😀", 3);

        assert.deepEqual(chunks, ["😀", "😀", "😀"]);
    });

    it("fits a two-unit character such as an emoji in the smallest allowed limit", () => {
        assert.deepEqual(chunkText("😀", 2), ["😀"]);
        assert.deepEqual(chunkText("a😀b", 2), ["a", "😀", "b"]);
    });

    it("keeps every chunk non-empty, within the limit and free of split surrogate pairs", () => {
        const inputs = ["😀", "a😀", "😀😀😀", "ab😀cd ef", "x 😀 y", "aaaa bbbb 😀😀 cc"];

        for (const maxChars of [2, 3, 4, 5]) {
            for (const input of inputs) {
                const chunks = chunkText(input, maxChars);
                const label = `${JSON.stringify(input)} with limit ${maxChars}`;

                assert.ok(chunks.every((chunk) => chunk !== "" && chunk.length <= maxChars), label);
                assert.ok(chunks.every((chunk) => !LONE_SURROGATE.test(chunk)), label);
                // nothing lost or duplicated: same characters in the same order, ignoring whitespace
                assert.equal(chunks.join("").replace(/\s/g, ""), input.replace(/\s/g, ""), label);
            }
        }
    });

    it("rejects a limit below 2, which a two-unit character could not fit", () => {
        assert.throws(() => chunkText("😀", 1), RangeError);
        assert.throws(() => chunkText("text", 1), RangeError);
        assert.throws(() => chunkText("text", 0), RangeError);
        assert.throws(() => chunkText("text", -5), RangeError);
    });

    it("rejects a limit that is not an integer", () => {
        assert.throws(() => chunkText("text", 2.5), RangeError);
    });
});
