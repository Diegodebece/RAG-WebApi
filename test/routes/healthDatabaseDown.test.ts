import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

// Points the app at a port where nothing listens, so the database check fails right away.
// Set before the app is imported; this file runs in its own process.
process.env.DATABASE_URL = "postgres://rag:wrong@127.0.0.1:1/nowhere";
process.env.OLLAMA_BASE_URL = "http://127.0.0.1:1";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");

after(() => pool.end());

describe("GET /v1/health with the dependencies down", () => {
    it("still answers, reporting the database and Ollama as down", async () => {
        const started = Date.now();
        const response = await request(app).get("/v1/health");

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, { status: "down", database: "down", ollama: "down" });
        assert.ok(Date.now() - started < 6000, "must not hang");
    });
});
