import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// A low per-minute limit, set before the app is imported (each test file runs in its own process).
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.UPLOAD_REQUESTS_PER_MINUTE = "2";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");

before(resetTestDatabase);

after(() => pool.end());

describe("upload requests per minute", () => {
    it("limits each user's upload requests per minute, before reading their body", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const send = (auth: [string, string], body: string) =>
            request(app).post("/v1/documents").set(...auth).set("Content-Type", "application/json").send(body);

        assert.equal((await send(ana.auth, "{}")).status, 400);
        assert.equal((await send(ana.auth, "{}")).status, 400);

        // a malformed body would be a 400 if it were parsed first
        const blocked = await send(ana.auth, "{");
        assert.equal(blocked.status, 429);
        assert.deepEqual(blocked.body, { message: "Too many requests, please try again later" });

        assert.equal((await send(bob.auth, "{}")).status, 400, "another user has their own counter");
    });
});
