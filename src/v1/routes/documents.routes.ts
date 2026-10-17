import express from "express";
import { createDocument, deleteDocument, getDocumentById, getDocuments } from "../controllers/documents.controller.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { createDocumentSchema } from "../validators/documents.validator.js";

export const documentsRouter = express.Router({ mergeParams: true });

documentsRouter.get("/", getDocuments);
documentsRouter.get("/:id", getDocumentById);
// extracted text can take more than 1 MB as JSON, so uploads raise the default 100 KB body limit to 2 MB
documentsRouter.post("/", express.json({ limit: "2mb" }), validateBodyMiddleware(createDocumentSchema), createDocument);
documentsRouter.delete("/:id", deleteDocument);
