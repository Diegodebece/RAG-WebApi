import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");

const expectedHeaders = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY"
};

const assertSecurityHeaders = (headers: Record<string, string>, label: string) => {
    for (const [name, value] of Object.entries(expectedHeaders)) {
        assert.equal(headers[name], value, `${label}: ${name}`);
    }
};

before(resetTestDatabase);

after(() => pool.end());

describe("security headers", () => {
    it("are sent on successful responses", async () => {
        const ana = await createTestUser("ana@example.com");

        const response = await request(app).get("/v1/users/me").set(...ana.auth);

        assert.equal(response.status, 200);
        assertSecurityHeaders(response.headers, "200");
    });

    it("are sent on error responses", async () => {
        const responses = {
            "401": await request(app).get("/v1/users/me"),
            "404": await request(app).get("/nothing-here"),
            "400 malformed JSON": await request(app).post("/v1/auth/login").set("Content-Type", "application/json").send("{")
        };

        for (const [label, response] of Object.entries(responses)) {
            assert.equal(String(response.status), label.split(" ")[0], label);
            assertSecurityHeaders(response.headers, label);
        }
    });
});

describe("request bodies", () => {
    it("are read only as JSON: a form-encoded body is ignored", async () => {
        const response = await request(app).post("/v1/auth/register").type("form").send("email=form@example.com&password=correct horse battery staple");

        assert.equal(response.status, 400);
        assert.equal(response.body.message, "Validation error");
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM users WHERE email = 'form@example.com'");
        assert.equal(rows[0].count, 0);
    });
});
