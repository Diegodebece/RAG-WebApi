import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Low limits, set before the app is imported (each test file runs in its own process, with its own counters).
process.env.SECRET_KEY = "test-secret-only-for-these-tests";
process.env.REGISTRATIONS_PER_HOUR = "2";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "1000";
process.env.LOGINS_PER_15_MINUTES = "4";
process.env.FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = "2";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");

const password = "correct horse battery staple";

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

// Counters persist between the tests of this file, so each test uses different emails and the tests
// run in order: registration first, then the login limits.
describe("rate limits on the auth routes", () => {
    it("allows only the configured number of new accounts per address; failed attempts do not count", async () => {
        assert.equal((await request(app).post("/v1/auth/register").send({ email: "bad", password })).status, 400);
        assert.equal((await request(app).post("/v1/auth/register").send({ email: "a@example.com", password })).status, 201);
        assert.equal((await request(app).post("/v1/auth/register").send({ email: "a@example.com", password })).status, 409);
        assert.equal((await request(app).post("/v1/auth/register").send({ email: "b@example.com", password })).status, 201);

        const blocked = await request(app).post("/v1/auth/register").send({ email: "c@example.com", password });
        assert.equal(blocked.status, 429);
        assert.deepEqual(blocked.body, { message: "Too many requests, please try again later" });
    });

    it("blocks an email after the configured number of failed logins", async () => {
        const attempt = (email: string) => request(app).post("/v1/auth/login").send({ email, password: "wrong password" });

        assert.equal((await attempt("x@example.com")).status, 401);
        assert.equal((await attempt("X@example.com")).status, 401);
        assert.equal((await attempt("x@example.com")).status, 429);
    });

    it("blocks an address after the configured number of logins, whatever the email", async () => {
        // the previous test already made three login requests from this address (the blocked one counts too);
        // the fourth is still allowed and the fifth passes the limit of 4
        assert.equal((await request(app).post("/v1/auth/login").send({ email: "y@example.com", password })).status, 401);
        assert.equal((await request(app).post("/v1/auth/login").send({ email: "z@example.com", password })).status, 429);
    });

    it("answers an address over the limit before reading the request body", async () => {
        // a malformed body would be a 400 if it were parsed first
        const response = await request(app).post("/v1/auth/login").set("Content-Type", "application/json").send("{");

        assert.equal(response.status, 429);
    });
});
