import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { authenticateMiddleware } from "../../src/v1/middlewares/authenticate.middleware.js";
import { authorizeMiddleware } from "../../src/v1/middlewares/authorize.middleware.js";
import { errorMiddleware } from "../../src/v1/middlewares/error.middleware.js";

const SECRET = "test-secret-only-for-these-tests";
const payload = { id: "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c", role: "user" };

const sign = (options: jwt.SignOptions = {}, secret = SECRET): string => jwt.sign(payload, secret, { expiresIn: "1h", ...options });

// a token with "alg": "none" and no signature, the classic forged token
const unsignedToken = (): string => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.`;
};

const buildApp = () => {
    const app = express();
    app.get("/me", authenticateMiddleware, (req, res) => res.json({ decoded: req.decoded }));
    app.get("/admin", authenticateMiddleware, authorizeMiddleware(["admin"]), (req, res) => res.json({ ok: true }));
    app.get("/admin-without-login", authorizeMiddleware(["admin"]), (req, res) => res.json({ ok: true }));
    app.use(errorMiddleware);
    return app;
};

const getWithToken = (path: string, token: string) => request(buildApp()).get(path).set("Authorization", `Bearer ${token}`);

describe("authenticateMiddleware", () => {
    let previousSecret: string | undefined;

    beforeEach(() => {
        previousSecret = process.env.SECRET_KEY;
        process.env.SECRET_KEY = SECRET;
    });

    afterEach(() => {
        process.env.SECRET_KEY = previousSecret;
    });

    it("puts the token payload in req.decoded", async () => {
        const response = await getWithToken("/me", sign());

        assert.equal(response.status, 200);
        assert.equal(response.body.decoded.id, payload.id);
        assert.equal(response.body.decoded.role, "user");
    });

    it("rejects a request without a token", async () => {
        const response = await request(buildApp()).get("/me");

        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { message: "Authentication token is missing" });
    });

    it("rejects a header that does not use the Bearer scheme", async () => {
        const response = await request(buildApp()).get("/me").set("Authorization", `Basic ${sign()}`);

        assert.equal(response.status, 401);
    });

    it("rejects malformed, expired, foreign and unsigned tokens with the same message", async () => {
        const tokens = {
            malformed: "not-a-token",
            expired: sign({ expiresIn: -10 }),
            "signed with another secret": sign({}, "another-secret"),
            unsigned: unsignedToken(),
            "signed with another algorithm": sign({ algorithm: "HS512" })
        };

        for (const [label, token] of Object.entries(tokens)) {
            const response = await getWithToken("/me", token);

            assert.equal(response.status, 401, label);
            assert.deepEqual(response.body, { message: "Invalid or expired authentication token" }, label);
        }
    });

    it("answers 500 when SECRET_KEY is not configured", async (t) => {
        t.mock.method(console, "error", () => {});
        delete process.env.SECRET_KEY;

        const response = await getWithToken("/me", sign());

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { message: "Internal server error" });
    });
});

describe("authorizeMiddleware", () => {
    let previousSecret: string | undefined;

    beforeEach(() => {
        previousSecret = process.env.SECRET_KEY;
        process.env.SECRET_KEY = SECRET;
    });

    afterEach(() => {
        process.env.SECRET_KEY = previousSecret;
    });

    it("lets a user with an allowed role through", async () => {
        const response = await getWithToken("/admin", jwt.sign({ ...payload, role: "admin" }, SECRET, { expiresIn: "1h" }));

        assert.equal(response.status, 200);
    });

    it("rejects a logged-in user without the role with a 403", async () => {
        const response = await getWithToken("/admin", sign());

        assert.equal(response.status, 403);
        assert.deepEqual(response.body, { message: "You do not have permission to perform this action" });
    });

    it("rejects a request that was never authenticated with a 401", async () => {
        const response = await request(buildApp()).get("/admin-without-login");

        assert.equal(response.status, 401);
    });
});
