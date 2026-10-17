import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";

// A fake Ollama, so these tests do not depend on the real one running on this computer.
type FakeOllamaMode = "ready" | "missing-model" | "error";
let mode: FakeOllamaMode = "ready";

const fakeOllama = createServer((req, res) => {
    if (mode === "error") {
        res.writeHead(500).end();
        return;
    }

    const models = mode === "ready"
        ? [{ name: "qwen3.5:4b" }, { name: "qwen3-embedding:0.6b" }]
        : [{ name: "qwen3.5:4b" }];
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ models }));
});

await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(fakeOllama.address() as AddressInfo).port}`;

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");

after(async () => {
    fakeOllama.close();
    await pool.end();
});

const getHealth = () => request(app).get("/v1/health");

describe("GET /v1/health", () => {
    it("reports ok when the database and Ollama with both models answer", async () => {
        mode = "ready";
        const response = await getHealth();

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, { status: "ok", database: "up", ollama: "up" });
    });

    it("reports degraded when an evaluated model is not installed", async () => {
        mode = "missing-model";
        const response = await getHealth();

        assert.deepEqual(response.body.data, { status: "degraded", database: "up", ollama: "down" });
    });

    it("reports degraded when Ollama answers with an error", async () => {
        mode = "error";
        const response = await getHealth();

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, { status: "degraded", database: "up", ollama: "down" });
    });

    it("is public and reveals nothing beyond the three states", async () => {
        mode = "ready";
        const response = await getHealth();

        assert.deepEqual(Object.keys(response.body.data).sort(), ["database", "ollama", "status"]);
        assert.equal(response.headers["x-powered-by"], undefined);
    });
});
