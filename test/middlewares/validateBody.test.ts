import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import Joi from "joi";
import { validateBodyMiddleware } from "../../src/v1/middlewares/validateBody.middleware.js";
import { errorMiddleware } from "../../src/v1/middlewares/error.middleware.js";

const schema = Joi.object({
    name: Joi.string().trim().required().messages({ "any.required": "Name is required" }),
    age: Joi.number().integer().messages({ "number.base": "Age must be a number" })
});

// echoes what the controller would receive
const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.post("/people", validateBodyMiddleware(schema), (req, res) => {
        res.json({ validatedBody: req.validatedBody });
    });
    app.use(errorMiddleware);
    return app;
};

describe("validateBodyMiddleware", () => {
    it("passes Joi's output, trimmed and converted, as req.validatedBody", async () => {
        const response = await request(buildApp()).post("/people").send({ name: "  Ana  ", age: "42" });

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.validatedBody, { name: "Ana", age: 42 });
    });

    it("reports every validation problem at once", async () => {
        const response = await request(buildApp()).post("/people").send({ age: "old" });

        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { message: "Validation error", details: ["Name is required", "Age must be a number"] });
    });

    it("rejects fields the schema does not know", async () => {
        const response = await request(buildApp()).post("/people").send({ name: "Ana", role: "admin" });

        assert.equal(response.status, 400);
        assert.deepEqual(response.body.details, ["\"role\" is not allowed"]);
    });

    it("rejects a request without a body instead of letting it reach the controller", async () => {
        const response = await request(buildApp()).post("/people");

        assert.equal(response.status, 400);
        assert.deepEqual(response.body.details, ["Name is required"]);
    });

    it("rejects a body that is not an object", async () => {
        const response = await request(buildApp()).post("/people").send(["Ana"]);

        assert.equal(response.status, 400);
    });
});
