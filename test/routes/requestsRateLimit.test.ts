import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";

// A low per-minute limit, set before the app is imported (each test file runs in its own process).
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.AUTHENTICATED_REQUESTS_PER_MINUTE = "3";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");

before(resetTestDatabase);

after(() => pool.end());

describe("requests per minute to the protected routes", () => {
    it("limits each user's requests across every protected route", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");

        assert.equal((await request(app).get("/v1/documents").set(...ana.auth)).status, 200);
        assert.equal((await request(app).get(`/v1/jobs/${randomUUID()}`).set(...ana.auth)).status, 404);
        assert.equal((await request(app).delete(`/v1/documents/${randomUUID()}`).set(...ana.auth)).status, 404);

        const blocked = await request(app).get("/v1/users/me").set(...ana.auth);
        assert.equal(blocked.status, 429);
        assert.deepEqual(blocked.body, { message: "Too many requests, please try again later" });

        assert.equal((await request(app).get("/v1/documents").set(...bob.auth)).status, 200, "another user has their own counter");
    });

    it("leaves the public routes out", async () => {
        for (let attempt = 0; attempt < 5; attempt++) {
            assert.notEqual((await request(app).get("/v1/health")).status, 429);
        }
    });
});
