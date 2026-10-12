import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeText } from "../../src/v1/utils/sanitizeText.util.js";

describe("sanitizeText", () => {
    it("keeps ordinary text, tabs and line breaks", () => {
        assert.equal(sanitizeText("Line one\n\tLine two"), "Line one\n\tLine two");
    });

    it("converts Windows and old Mac line endings to \\n", () => {
        assert.equal(sanitizeText("a\r\nb\rc"), "a\nb\nc");
    });

    it("removes control characters, including the null byte PostgreSQL rejects", () => {
        assert.equal(sanitizeText("a\u0000b\u0007c\u001Bd\u007Fe\u0085f"), "abcdef");
    });

    it("removes byte order marks", () => {
        assert.equal(sanitizeText("﻿hello﻿ world"), "hello world");
    });

    it("replaces lone surrogates and keeps valid pairs", () => {
        assert.equal(sanitizeText("a\uD800b"), "a�b");
        assert.equal(sanitizeText("a\uDC00b"), "a�b");
        assert.equal(sanitizeText("emoji 😀"), "emoji 😀");
    });

    it("normalizes to NFC so equal-looking text has one encoding", () => {
        assert.equal(sanitizeText("Café"), "Café");
    });

    it("trims and returns an empty string when nothing readable is left", () => {
        assert.equal(sanitizeText("  \n hello \t "), "hello");
        assert.equal(sanitizeText("\u0000\u0001 \r\n ﻿"), "");
    });
});
