import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.CORS_ORIGINS = "https://app.example.com, https://staging.example.com";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");

after(() => pool.end());

describe("CORS", () => {
    it("lets the configured frontends call the API from a browser", async () => {
        for (const origin of ["https://app.example.com", "https://staging.example.com"]) {
            const response = await request(app).get("/nothing-here").set("Origin", origin);
            assert.equal(response.headers["access-control-allow-origin"], origin, origin);
        }
    });

    it("answers a preflight from a configured frontend, including the Authorization header", async () => {
        const response = await request(app)
            .options("/v1/users/me")
            .set("Origin", "https://app.example.com")
            .set("Access-Control-Request-Method", "GET")
            .set("Access-Control-Request-Headers", "authorization");

        assert.equal(response.status, 204);
        assert.equal(response.headers["access-control-allow-origin"], "https://app.example.com");
        assert.match(String(response.headers["access-control-allow-headers"]), /authorization/i);
    });

    it("gives any other site no permission", async () => {
        const response = await request(app).get("/nothing-here").set("Origin", "https://evil.example");

        assert.equal(response.headers["access-control-allow-origin"], undefined);
    });
});
