import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getStartupConfigProblems, readIntegerSetting, readListSetting } from "../../src/v1/config/env.config.js";

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

describe("readIntegerSetting and readListSetting", () => {
    const withSetting = <T>(value: string | undefined, read: () => T): T => {
        const previous = process.env.TEST_SETTING;
        if (value === undefined) {
            delete process.env.TEST_SETTING;
        } else {
            process.env.TEST_SETTING = value;
        }
        try {
            return read();
        } finally {
            if (previous === undefined) {
                delete process.env.TEST_SETTING;
            } else {
                process.env.TEST_SETTING = previous;
            }
        }
    };

    it("uses the default when the setting is missing or empty, and the value when it is valid", () => {
        assert.equal(withSetting(undefined, () => readIntegerSetting("TEST_SETTING", 7)), 7);
        assert.equal(withSetting("  ", () => readIntegerSetting("TEST_SETTING", 7)), 7);
        assert.equal(withSetting("42", () => readIntegerSetting("TEST_SETTING", 7)), 42);
        assert.equal(withSetting("0", () => readIntegerSetting("TEST_SETTING", 7, 0)), 0);
    });

    it("stops the app at startup on a value outside the range or that is not a whole number", () => {
        for (const value of ["abc", "1.5", "0", "-5", "1e3x"]) {
            assert.throws(() => withSetting(value, () => readIntegerSetting("TEST_SETTING", 7)), /TEST_SETTING must be a whole number at least 1/, value);
        }
        assert.throws(() => withSetting("70000", () => readIntegerSetting("TEST_SETTING", 3000, 1, 65535)), /from 1 to 65535/);
    });

    it("reads a comma-separated list, trimming and dropping empty entries", () => {
        assert.deepEqual(withSetting(" a, b ,,c ", () => readListSetting("TEST_SETTING")), ["a", "b", "c"]);
        assert.deepEqual(withSetting(undefined, () => readListSetting("TEST_SETTING", ["loopback"])), ["loopback"]);
        assert.deepEqual(withSetting(" , ", () => readListSetting("TEST_SETTING", ["loopback"])), ["loopback"]);
    });
});
