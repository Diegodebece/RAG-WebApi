import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Plenty of accounts allowed, but only 3 registration requests per address: probing a taken email
// (409 every time) must run into the limit too.
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.REGISTRATIONS_PER_HOUR = "1000";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "3";

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

    it("is not reset by a spoofed X-Forwarded-For header", async () => {
        const response = await request(app)
            .post("/v1/auth/register")
            .set("X-Forwarded-For", "203.0.113.9")
            .send({ email: "other@example.com", password });

        assert.equal(response.status, 429);
    });
});
