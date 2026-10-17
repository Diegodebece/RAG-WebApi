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
    app.post("/login", rateLimitMiddleware({ limit, windowMs: MINUTE, keyBy: "emailAndIp", onlyFailures: true }), (req, res) => {
        res.status(req.body.password === "right" ? 200 : 401).json({});
    });
    app.use(errorMiddleware);
    return app;
};

describe("failed-login limit and account lockout", () => {
    // Two clients behind a proxy on this computer, with the same trust proxy setting as the real app
    // (test/routes/clientAddress.test.ts checks the real app itself).
    const buildTwoClientApp = () => {
        const app = express();
        app.set("trust proxy", "loopback");
        app.use(express.json());
        app.post("/login", rateLimitMiddleware({ limit: 2, windowMs: MINUTE, keyBy: "emailAndIp", onlyFailures: true }), (req, res) => {
            res.status(req.body.password === "right" ? 200 : 401).json({});
        });
        app.use(errorMiddleware);
        return app;
    };

    it("does not let an attacker lock the owner out of their account", async () => {
        const app = request(buildTwoClientApp());

        for (let attempt = 0; attempt < 3; attempt++) {
            await app.post("/login").set("X-Forwarded-For", "203.0.113.66").send({ email: "victim@example.com", password: "guess" });
        }

        const owner = await app.post("/login").set("X-Forwarded-For", "198.51.100.7").send({ email: "victim@example.com", password: "right" });
        assert.equal(owner.status, 200);
    });

    it("still stops the attacker from guessing that account from their own address", async () => {
        const app = request(buildTwoClientApp());
        const guess = () => app.post("/login").set("X-Forwarded-For", "203.0.113.66").send({ email: "victim@example.com", password: "guess" });

        assert.equal((await guess()).status, 401);
        assert.equal((await guess()).status, 401);
        assert.equal((await guess()).status, 429);
    });
});

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

    it("counts both Unicode spellings of an accented email together", async () => {
        const app = request(buildFailedLoginApp(2));
        const precomposed = `jos${String.fromCodePoint(0xe9)}@example.com`;
        const decomposed = `jose${String.fromCodePoint(0x301)}@example.com`;

        await app.post("/login").send({ email: precomposed, password: "wrong" });
        await app.post("/login").send({ email: decomposed, password: "wrong" });

        assert.equal((await app.post("/login").send({ email: precomposed, password: "wrong" })).status, 429);
    });

    it("counts the same email with any capitalization together, and other emails apart", async () => {
        const app = request(buildFailedLoginApp(2));

        await app.post("/login").send({ email: "ana@example.com", password: "wrong" });
        await app.post("/login").send({ email: "  ANA@Example.com ", password: "wrong" });

        assert.equal((await app.post("/login").send({ email: "Ana@example.com", password: "wrong" })).status, 429);
        assert.equal((await app.post("/login").send({ email: "bob@example.com", password: "wrong" })).status, 401);
    });
});

describe("per-user limit", () => {
    // stands in for authenticateMiddleware: the test says who is logged in with a header
    const buildUserLimitedApp = (limit: number) => {
        const app = express();
        app.set("trust proxy", "loopback");
        app.use((req, res, next) => {
            const userId = req.header("X-Test-User");

            if (userId) {
                req.decoded = { id: userId, role: "user", expiresAt: Date.now() + 60_000 };
            }

            next();
        });
        app.post("/ask", rateLimitMiddleware({ limit, windowMs: MINUTE, keyBy: "user" }), (req, res) => {
            res.status(200).json({ ok: true });
        });
        app.use(errorMiddleware);
        return app;
    };

    it("counts each user separately, whatever address they use", async () => {
        const app = request(buildUserLimitedApp(2));
        const ask = (userId: string, address: string) => app.post("/ask").set("X-Test-User", userId).set("X-Forwarded-For", address);

        assert.equal((await ask("ana", "203.0.113.1")).status, 200);
        assert.equal((await ask("ana", "203.0.113.2")).status, 200);
        assert.equal((await ask("ana", "203.0.113.3")).status, 429, "a new address does not reset the user's counter");
        assert.equal((await ask("bob", "203.0.113.1")).status, 200, "another user from the same address has their own counter");
    });

    it("falls back to the address when nobody is logged in", async () => {
        const app = request(buildUserLimitedApp(1));

        assert.equal((await app.post("/ask")).status, 200);
        assert.equal((await app.post("/ask")).status, 429);
    });
});
