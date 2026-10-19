import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import request from "supertest";
import jwt from "jsonwebtoken";

// Set before the app is imported: limits are read once, when their module loads. These tests register many
// users from one address, so the limits are raised here; authRateLimit.test.ts checks them with low values.
const SECRET = "test-secret-only-for-these-tests";
process.env.SECRET_KEY = SECRET;
process.env.REGISTRATIONS_PER_HOUR = "1000";
process.env.REGISTRATION_ATTEMPTS_PER_HOUR = "1000";
process.env.LOGINS_PER_15_MINUTES = "1000";
process.env.FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = "1000";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");

const credentials = { email: "ana@example.com", password: "correct horse battery staple" };

const register = (body: object = credentials) => request(app).post("/v1/auth/register").send(body);

const login = (body: object = credentials) => request(app).post("/v1/auth/login").send(body);

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("POST /v1/auth/register", () => {
    it("creates the account and returns the user and a token", async () => {
        const response = await register({ email: "  Ana@Example.COM ", password: credentials.password });

        assert.equal(response.status, 201);
        assert.equal(response.body.success, true);
        assert.deepEqual(Object.keys(response.body.data).sort(), ["createdAt", "email", "id", "role"]);
        assert.equal(response.body.data.email, "ana@example.com");
        assert.equal(response.body.data.role, "user");

        const payload = jwt.verify(response.body.token, SECRET) as jwt.JwtPayload;
        assert.equal(payload.id, response.body.data.id);
        assert.equal(payload.role, "user");
        assert.equal((payload.exp ?? 0) - (payload.iat ?? 0), 3600);
    });

    it("stores a scrypt hash, never the password", async () => {
        await register();

        const { rows } = await pool.query<{ password_hash: string }>("SELECT password_hash FROM users");
        assert.match(rows[0].password_hash, /^scrypt\$/);
        assert.ok(!rows[0].password_hash.includes(credentials.password));
    });

    it("rejects an email that is already registered, in any capitalization", async () => {
        await register();

        const response = await register({ email: "ANA@example.com", password: "another password" });

        assert.equal(response.status, 409);
        assert.deepEqual(response.body, { message: "Email is already registered" });
    });

    it("rejects invalid emails and passwords outside 8 to 64 characters", async () => {
        const cases = {
            "invalid email": { email: "not-an-email", password: credentials.password },
            "short password": { email: credentials.email, password: "1234567" },
            "long password": { email: credentials.email, password: "x".repeat(65) },
            "missing password": { email: credentials.email }
        };

        for (const [label, body] of Object.entries(cases)) {
            const response = await register(body);
            assert.equal(response.status, 400, label);
            assert.equal(response.body.message, "Validation error", label);
        }
    });

    it("accepts passwords of exactly 8 and 64 characters", async () => {
        assert.equal((await register({ email: "a@example.com", password: "x".repeat(8) })).status, 201);
        assert.equal((await register({ email: "b@example.com", password: "x".repeat(64) })).status, 201);
    });

    it("refuses to let a client choose its own role", async () => {
        const response = await register({ ...credentials, role: "admin" });

        assert.equal(response.status, 400);
        assert.deepEqual(response.body.details, ["\"role\" is not allowed"]);
    });
});

describe("POST /v1/auth/login", () => {
    it("returns the user and a token for the right password", async () => {
        const registered = await register();

        const response = await login({ email: "ANA@example.com", password: credentials.password });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.id, registered.body.data.id);
        assert.ok(!("passwordHash" in response.body.data));
        assert.equal((jwt.verify(response.body.token, SECRET) as jwt.JwtPayload).id, registered.body.data.id);
    });

    it("answers a wrong password and an unknown email with the same 401", async () => {
        await register();

        const wrongPassword = await login({ email: credentials.email, password: "wrong password" });
        const unknownEmail = await login({ email: "nobody@example.com", password: credentials.password });

        assert.equal(wrongPassword.status, 401);
        assert.equal(unknownEmail.status, 401);
        assert.deepEqual(wrongPassword.body, { message: "Invalid email or password" });
        assert.deepEqual(unknownEmail.body, wrongPassword.body);
    });

    it("moves a password hashed with the earlier cost parameters to the current ones on login", async () => {
        const salt = randomBytes(16);
        const hash = scryptSync(credentials.password, salt, 64, { N: 16384, r: 8, p: 1 });
        const oldHash = ["scrypt", 16384, 8, 1, salt.toString("hex"), hash.toString("hex")].join("$");
        await pool.query("INSERT INTO users (email, password_hash) VALUES ($1, $2)", [credentials.email, oldHash]);
        const storedHash = async () => (await pool.query<{ hash: string }>("SELECT password_hash AS hash FROM users")).rows[0].hash;

        assert.equal((await login({ email: credentials.email, password: "wrong password" })).status, 401);
        assert.equal(await storedHash(), oldHash, "a failed login changes nothing");

        assert.equal((await login()).status, 200);
        assert.match(await storedHash(), /^scrypt\$16384\$8\$5\$/);
        assert.equal((await login()).status, 200, "the new hash accepts the same password");
    });
});

describe("GET /v1/users/me", () => {
    it("returns the account of the token's owner", async () => {
        const { body } = await register();

        const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${body.token}`);

        assert.equal(response.status, 200);
        const { usage, ...account } = response.body.data;
        assert.deepEqual(account, body.data);
        assert.deepEqual(usage, { documents: { used: 0, limit: 3 }, uploadsToday: { used: 0, limit: 3 }, questionsToday: { used: 0, limit: 30 } });
    });

    it("requires a token", async () => {
        const response = await request(app).get("/v1/users/me");

        assert.equal(response.status, 401);
    });

    it("answers 404 when the token's account no longer exists", async () => {
        const { body } = await register();
        await pool.query("DELETE FROM users");

        const response = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${body.token}`);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, { message: "User not found" });
    });
});
