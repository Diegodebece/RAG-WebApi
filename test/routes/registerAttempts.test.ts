import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Plenty of accounts allowed, but only 3 registration requests per address: probing a taken email
// (409 every time) must run into the limit too.
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.REGISTRATIONS_PER_HOUR = "1000";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "3";
// the tests connect from this computer; trusting another address makes them a client, not a trusted proxy
process.env.TRUSTED_PROXIES = "192.0.2.1";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");

const password = "correct horse battery staple";

before(resetTestDatabase);

after(() => pool.end());

describe("registration attempts per address", () => {
    it("limits repeated attempts with a taken email, so accounts cannot be enumerated without limit", async () => {
        const register = () => request(app).post("/v1/auth/register").send({ email: "taken@example.com", password });

        assert.equal((await register()).status, 201);
        assert.equal((await register()).status, 409);
        assert.equal((await register()).status, 409);
        assert.equal((await register()).status, 429);
    });

    it("is not reset by an X-Forwarded-For header from a client that is not a trusted proxy", async () => {
        const response = await request(app)
            .post("/v1/auth/register")
            .set("X-Forwarded-For", "203.0.113.9")
            .send({ email: "other@example.com", password });

        assert.equal(response.status, 429);
    });

    it("answers an address over the limit before reading the request body", async () => {
        // a malformed body would be a 400 if it were parsed first
        const response = await request(app).post("/v1/auth/register").set("Content-Type", "application/json").send("{");

        assert.equal(response.status, 429);
    });
});
