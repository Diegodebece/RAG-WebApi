import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Abuse and edge cases of the auth endpoints. Limits are raised so they do not interfere;
// the limits themselves are covered by authRateLimit.test.ts and registerAttempts.test.ts.
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.REGISTRATIONS_PER_HOUR = "1000";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "1000";
process.env.LOGINS_PER_15_MINUTES = "1000";
process.env.FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = "1000";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");

const password = "correct horse battery staple";

// special characters built from code points, so this file stays plain ASCII
const char = (codePoint: number) => String.fromCodePoint(codePoint);

const register = (body: object) => request(app).post("/v1/auth/register").send(body);

const countUsers = async (): Promise<number> => (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM users")).rows[0].count;

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("auth input abuse", () => {
    it("ignores a __proto__ key: the account is created as a normal user", async () => {
        const response = await request(app)
            .post("/v1/auth/register")
            .set("Content-Type", "application/json")
            .send(`{"email":"proto@example.com","password":"${password}","__proto__":{"role":"admin"}}`);

        assert.notEqual(response.body.data?.role, "admin");
        const { rows } = await pool.query("SELECT role FROM users");
        assert.ok(rows.every((row) => row.role === "user"));
    });

    it("rejects an email with a null byte with a 400, not a database error", async () => {
        const response = await register({ email: `a${char(0)}b@example.com`, password });

        assert.equal(response.status, 400);
    });

    it("rejects a 90,000-character email quickly", async () => {
        const started = Date.now();
        const response = await register({ email: `${"a".repeat(90000)}@example.com`, password });

        assert.equal(response.status, 400);
        assert.ok(Date.now() - started < 1000);
    });

    it("answers a body over the size limit with 413 and the usual error shape", async () => {
        const response = await register({ email: "big@example.com", password, filler: "x".repeat(200000) });

        assert.equal(response.status, 413);
        assert.deepEqual(Object.keys(response.body), ["message"]);
    });

    it("rejects bodies that are not a JSON object", async () => {
        for (const body of ["\"just a string\"", "[1,2]", "null", "42"]) {
            const response = await request(app).post("/v1/auth/login").set("Content-Type", "application/json").send(body);
            assert.equal(response.status, 400, body);
        }
    });

    it("rejects form-encoded arrays where a string is expected", async () => {
        const response = await request(app)
            .post("/v1/auth/login")
            .type("form")
            .send(`email[]=a@example.com&email[]=b@example.com&password=${encodeURIComponent(password)}`);

        assert.equal(response.status, 400);
    });

    it("creates one account when the same email registers twice at the same time", async () => {
        const responses = await Promise.all([1, 2].map(() => register({ email: "race@example.com", password })));

        assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
        assert.equal(await countUsers(), 1);
    });
});

describe("Unicode normalization", () => {
    // "jose" with an accented e: one precomposed character (NFC) or "e" plus a combining accent (NFD)
    const precomposed = `jos${char(0xe9)}@example.com`;
    const decomposed = `jose${char(0x301)}@example.com`;

    it("treats both spellings of an accented email as the same account", async () => {
        assert.equal((await register({ email: precomposed, password })).status, 201);

        const second = await register({ email: decomposed, password });

        assert.equal(second.status, 409);
        assert.equal(await countUsers(), 1);
    });

    it("logs in with the other spelling of the same email", async () => {
        await register({ email: precomposed, password });

        const response = await request(app).post("/v1/auth/login").send({ email: decomposed, password });

        assert.equal(response.status, 200);
    });

    it("accepts a password typed with a different Unicode form of the same accents", async () => {
        const typedOnWindows = `caf${char(0xe9)} con le${char(0xf1)}a 2026`;
        const typedOnMac = `cafe${char(0x301)} con len${char(0x303)}a 2026`;
        await register({ email: "accents@example.com", password: typedOnWindows });

        const response = await request(app).post("/v1/auth/login").send({ email: "accents@example.com", password: typedOnMac });

        assert.equal(response.status, 200);
    });
});

describe("misconfiguration", () => {
    it("does not create the account when SECRET_KEY is missing", async (t) => {
        t.mock.method(console, "error", () => {});
        const saved = process.env.SECRET_KEY;
        delete process.env.SECRET_KEY;

        try {
            const response = await register({ email: "nosecret@example.com", password });

            assert.equal(response.status, 500);
            assert.equal(await countUsers(), 0);
        } finally {
            process.env.SECRET_KEY = saved;
        }
    });
});
