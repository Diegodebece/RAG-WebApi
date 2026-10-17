import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { rateLimitMiddleware } from "../../src/v1/middlewares/rateLimit.middleware.js";
import { errorMiddleware } from "../../src/v1/middlewares/error.middleware.js";

const MINUTE = 60_000;

// every test builds its own app, so counters never carry over between tests
const buildIpLimitedApp = (limit: number) => {
    const app = express();
    app.post("/register", rateLimitMiddleware({ limit, windowMs: MINUTE, keyBy: "ip" }), (req, res) => {
        res.status(201).json({ ok: true });
    });
    app.use(errorMiddleware);
    return app;
};

// a fake login: the right password succeeds, anything else is a 401
const buildFailedLoginApp = (limit: number) => {
    const app = express();
    app.use(express.json());
    app.post("/login", rateLimitMiddleware({ limit, windowMs: MINUTE, keyBy: "email", onlyFailures: true }), (req, res) => {
        res.status(req.body.password === "right" ? 200 : 401).json({});
    });
    app.use(errorMiddleware);
    return app;
};

describe("rateLimitMiddleware", () => {
    it("answers 429 with the usual error body once a client passes the limit", async () => {
        const agent = request(buildIpLimitedApp(2));

        assert.equal((await agent.post("/register")).status, 201);
        assert.equal((await agent.post("/register")).status, 201);

        const blocked = await agent.post("/register");
        assert.equal(blocked.status, 429);
        assert.deepEqual(blocked.body, { message: "Too many requests, please try again later" });
    });

    it("tells the client its limit in standard headers", async () => {
        const response = await request(buildIpLimitedApp(3)).post("/register");

        assert.ok(response.headers["ratelimit-policy"]);
        assert.ok(response.headers["ratelimit"]);
    });

    it("counts only failed attempts when onlyFailures is set", async () => {
        const app = request(buildFailedLoginApp(2));

        for (let attempt = 0; attempt < 5; attempt++) {
            assert.equal((await app.post("/login").send({ email: "ana@example.com", password: "right" })).status, 200);
        }

        assert.equal((await app.post("/login").send({ email: "ana@example.com", password: "wrong" })).status, 401);
        assert.equal((await app.post("/login").send({ email: "ana@example.com", password: "wrong" })).status, 401);
        assert.equal((await app.post("/login").send({ email: "ana@example.com", password: "wrong" })).status, 429);
    });

    it("counts the same email with any capitalization together, and other emails apart", async () => {
        const app = request(buildFailedLoginApp(2));

        await app.post("/login").send({ email: "ana@example.com", password: "wrong" });
        await app.post("/login").send({ email: "  ANA@Example.com ", password: "wrong" });

        assert.equal((await app.post("/login").send({ email: "Ana@example.com", password: "wrong" })).status, 429);
        assert.equal((await app.post("/login").send({ email: "bob@example.com", password: "wrong" })).status, 401);
    });
});
