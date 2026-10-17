import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import type { RequestHandler } from "express";
import { requireUserId } from "../../src/v1/utils/requireUserId.util.js";
import { AppError } from "../../src/v1/utils/appError.util.js";
import { errorMiddleware } from "../../src/v1/middlewares/error.middleware.js";
import { createDocument, deleteDocument, getDocumentById, getDocuments } from "../../src/v1/controllers/documents.controller.js";
import { getJobById } from "../../src/v1/controllers/jobs.controller.js";
import { getCurrentUser } from "../../src/v1/controllers/users.controller.js";
import { pool } from "../../src/v1/config/db.config.js";

after(() => pool.end());

describe("requireUserId", () => {
    it("returns the id of the logged-in user", () => {
        assert.equal(requireUserId({ decoded: { id: "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c", role: "user" } }), "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c");
    });

    it("throws a 401 AppError when the request was not authenticated", () => {
        assert.throws(() => requireUserId({}), (error: unknown) => error instanceof AppError && error.status === 401);
    });
});

describe("controllers that need the logged-in user", () => {
    it("answer 401, not 500, when mounted without authenticateMiddleware by mistake", async () => {
        const controllers: Record<string, RequestHandler<{ id: string }>> = { getDocuments, getDocumentById, createDocument, deleteDocument, getJobById, getCurrentUser };

        for (const [name, controller] of Object.entries(controllers)) {
            const app = express();
            app.get("/:id", controller);
            app.use(errorMiddleware);

            const response = await request(app).get("/3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c");

            assert.equal(response.status, 401, name);
            assert.deepEqual(response.body, { message: "Authentication required" }, name);
        }
    });
});
