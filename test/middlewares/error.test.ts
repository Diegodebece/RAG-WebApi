import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Request, Response } from "express";
import request from "supertest";
import { errorMiddleware } from "../../src/v1/middlewares/error.middleware.js";
import { notFoundMiddleware } from "../../src/v1/middlewares/notFound.middleware.js";
import { AppError } from "../../src/v1/utils/appError.util.js";

// an app whose /fail route passes the given error to next(), like a controller's catch block
const buildApp = (error?: unknown) => {
    const app = express();
    app.use(express.json());
    app.get("/fail", (req, res, next) => next(error));
    app.post("/echo", (req, res) => res.json(req.body));
    app.use(notFoundMiddleware);
    app.use(errorMiddleware);
    return app;
};

describe("errorMiddleware", () => {
    it("answers an AppError with its status and message", async () => {
        const response = await request(buildApp(new AppError(409, "Email already registered"))).get("/fail");

        assert.equal(response.status, 409);
        assert.deepEqual(response.body, { message: "Email already registered" });
    });

    it("includes the details of a validation error", async () => {
        const response = await request(buildApp(new AppError(400, "Validation error", ["Email is required"]))).get("/fail");

        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { message: "Validation error", details: ["Email is required"] });
    });

    it("answers malformed JSON with a 400 instead of a 500", async () => {
        const response = await request(buildApp()).post("/echo").set("Content-Type", "application/json").send("{bad");

        assert.equal(response.status, 400);
        assert.deepEqual(Object.keys(response.body), ["message"]);
    });

    it("answers unexpected errors with a generic 500 that does not leak their message", async (t) => {
        const consoleError = t.mock.method(console, "error", () => {});
        const response = await request(buildApp(new Error("password authentication failed for user rag"))).get("/fail");

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { message: "Internal server error" });
        assert.equal(consoleError.mock.callCount(), 1);
    });

    it("also handles values that are not errors", async (t) => {
        t.mock.method(console, "error", () => {});
        const response = await request(buildApp("something odd")).get("/fail");

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { message: "Internal server error" });
    });
});

describe("errorMiddleware after the response has started", () => {
    it("hands the error to Express instead of trying to send a second response", () => {
        const error = new AppError(400, "Too late for a status");
        const forwarded: unknown[] = [];
        // a response whose headers are already out: any attempt to send another status must not happen
        const response = {
            headersSent: true,
            status: () => {
                throw new Error("status() must not be called after the headers were sent");
            }
        };

        errorMiddleware(error, {} as Request, response as unknown as Response, (value?: unknown) => {
            forwarded.push(value);
        });

        assert.deepEqual(forwarded, [error]);
    });
});

describe("notFoundMiddleware", () => {
    it("answers unknown routes with a 404", async () => {
        const response = await request(buildApp()).get("/nowhere");

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, { message: "Route not found" });
    });
});

