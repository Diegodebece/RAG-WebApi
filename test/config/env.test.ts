import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getStartupConfigProblems } from "../../src/v1/config/env.config.js";

describe("getStartupConfigProblems", () => {
    it("accepts a long random SECRET_KEY", () => {
        assert.deepEqual(getStartupConfigProblems({ SECRET_KEY: "a".repeat(32) }), []);
    });

    it("refuses to start without SECRET_KEY", () => {
        assert.deepEqual(getStartupConfigProblems({}), ["SECRET_KEY is not set"]);
        assert.deepEqual(getStartupConfigProblems({ SECRET_KEY: "" }), ["SECRET_KEY is not set"]);
    });

    it("refuses the placeholder from .env.example and short secrets", () => {
        for (const secret of ["change-me", "short", "a".repeat(31)]) {
            assert.deepEqual(
                getStartupConfigProblems({ SECRET_KEY: secret }),
                ["SECRET_KEY must be a random value of at least 32 characters"],
                secret
            );
        }
    });
});
