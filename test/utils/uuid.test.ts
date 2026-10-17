import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "../../src/v1/utils/uuid.util.js";

describe("isUuid", () => {
    it("accepts UUIDs in lower or upper case", () => {
        assert.equal(isUuid("3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c"), true);
        assert.equal(isUuid("3F2B8C1E-9A4D-4E7F-B2C1-8D5E6F7A9B0C"), true);
    });

    it("rejects anything PostgreSQL would refuse as a uuid", () => {
        for (const value of ["", "not-a-uuid", "3f2b8c1e9a4d4e7fb2c18d5e6f7a9b0c", "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0", "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c ", "' OR 1=1 --"]) {
            assert.equal(isUuid(value), false, value);
        }
    });
});
