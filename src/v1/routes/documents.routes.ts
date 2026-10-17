import express from "express";
import { QUESTION_WINDOW_MS, QUESTIONS_PER_MINUTE } from "../config/limits.config.js";
import { createDocument, deleteDocument, getDocumentById, getDocuments } from "../controllers/documents.controller.js";
import { askQuestion } from "../controllers/questions.controller.js";
import { rateLimitMiddleware } from "../middlewares/rateLimit.middleware.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { createDocumentSchema } from "../validators/documents.validator.js";
import { askQuestionSchema } from "../validators/questions.validator.js";

export const documentsRouter = express.Router({ mergeParams: true });

documentsRouter.get("/", getDocuments);
documentsRouter.get("/:id", getDocumentById);
// extracted text can take more than 1 MB as JSON, so uploads raise the default 100 KB body limit to 2 MB
documentsRouter.post("/", express.json({ limit: "2mb" }), validateBodyMiddleware(createDocumentSchema), createDocument);
documentsRouter.delete("/:id", deleteDocument);
documentsRouter.post(
    "/:id/ask",
    rateLimitMiddleware({ limit: QUESTIONS_PER_MINUTE, windowMs: QUESTION_WINDOW_MS, keyBy: "user" }),
    express.json(),
    validateBodyMiddleware(askQuestionSchema),
    askQuestion
);
