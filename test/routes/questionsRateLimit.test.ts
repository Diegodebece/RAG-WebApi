import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// A low per-minute limit, set before the app is imported (each test file runs in its own process).
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.QUESTIONS_PER_MINUTE = "2";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");

before(resetTestDatabase);

after(() => pool.end());

describe("questions per minute", () => {
    it("limits each user's ask requests per minute, whatever their outcome", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        // an unknown document: the limit counts the request before anything else runs
        const ask = (auth: [string, string]) =>
            request(app).post("/v1/documents/00000000-0000-4000-8000-000000000000/ask").set(...auth).send({ question: "What?" });

        assert.equal((await ask(ana.auth)).status, 404);
        assert.equal((await ask(ana.auth)).status, 404);

        const blocked = await ask(ana.auth);
        assert.equal(blocked.status, 429);
        assert.deepEqual(blocked.body, { message: "Too many requests, please try again later" });

        assert.equal((await ask(bob.auth)).status, 404, "another user has their own counter");
    });
});
