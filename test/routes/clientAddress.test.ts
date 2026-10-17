import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// The real app with its default proxy setting: the tests connect from this computer, as cloudflared does,
// and X-Forwarded-For carries the address Cloudflare saw. Low limits, so the counters are easy to reach.
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.REGISTRATIONS_PER_HOUR = "1000";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "1000";
process.env.LOGINS_PER_15_MINUTES = "1000";
process.env.FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = "2";
delete process.env.TRUSTED_PROXIES;

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");

const password = "correct horse battery staple";

// a login as seen through the tunnel: the client's address is in X-Forwarded-For
const loginFrom = (forwardedFor: string, email: string, attempt: string) =>
    request(app).post("/v1/auth/login").set("X-Forwarded-For", forwardedFor).send({ email, password: attempt });

before(async () => {
    await resetTestDatabase();
    await request(app).post("/v1/auth/register").send({ email: "victim@example.com", password });
    await request(app).post("/v1/auth/register").send({ email: "other@example.com", password });
});

after(() => pool.end());

describe("client addresses behind the tunnel", () => {
    it("does not let an attacker lock the owner out: each address has its own counter", async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            await loginFrom("203.0.113.66", "victim@example.com", "wrong guess");
        }

        assert.equal((await loginFrom("203.0.113.66", "victim@example.com", "wrong guess")).status, 429, "the attacker is blocked");
        assert.equal((await loginFrom("198.51.100.7", "victim@example.com", password)).status, 200, "the owner, from another address, is not");
    });

    it("ignores the addresses a client writes into the header itself", async () => {
        // Cloudflare appends the real address at the end; anything before it was written by the client
        for (let attempt = 0; attempt < 2; attempt++) {
            await loginFrom("198.51.100.99, 203.0.113.77", "other@example.com", "wrong guess");
        }

        assert.equal((await loginFrom("198.51.100.42, 203.0.113.77", "other@example.com", "wrong guess")).status, 429, "a new fake address does not reset the counter");
        assert.equal((await loginFrom("198.51.100.99", "other@example.com", password)).status, 200, "the address the client pretended to have is not blocked");
    });
});
