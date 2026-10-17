import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";

// A fake Ollama that counts how often it is asked for its models.
let ollamaRequests = 0;
const fakeOllama = createServer((req, res) => {
    ollamaRequests++;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ models: [{ name: "qwen3.5:4b" }, { name: "qwen3-embedding:0.6b" }] }));
});
await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(fakeOllama.address() as AddressInfo).port}`;
process.env.HEALTH_CACHE_SECONDS = "60";
process.env.HEALTH_CHECKS_PER_MINUTE = "5";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");

after(async () => {
    fakeOllama.close();
    await pool.end();
});

describe("GET /v1/health under load", () => {
    it("reuses one check for the requests of the next seconds, also when they arrive together", async () => {
        const responses = await Promise.all([1, 2, 3].map(() => request(app).get("/v1/health").set("X-Forwarded-For", "203.0.113.1")));
        const later = await request(app).get("/v1/health").set("X-Forwarded-For", "203.0.113.2");

        assert.deepEqual([...responses, later].map((response) => response.body.data.status), ["ok", "ok", "ok", "ok"]);
        assert.equal(ollamaRequests, 1, "Ollama was asked once for four requests");
    });

    it("limits each address to the configured number of checks per minute", async () => {
        const check = (address: string) => request(app).get("/v1/health").set("X-Forwarded-For", address);

        for (let attempt = 0; attempt < 5; attempt++) {
            assert.equal((await check("198.51.100.1")).status, 200);
        }

        assert.equal((await check("198.51.100.1")).status, 429);
        assert.equal((await check("198.51.100.2")).status, 200, "another address has its own counter");
    });
});
