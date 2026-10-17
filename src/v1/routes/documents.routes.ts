import express from "express";
import { createDocument, deleteDocument, getDocumentById, getDocuments } from "../controllers/documents.controller.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { createDocumentSchema } from "../validators/documents.validator.js";

export const documentsRouter = express.Router({ mergeParams: true });

documentsRouter.get("/", getDocuments);
documentsRouter.get("/:id", getDocumentById);
// uploads parse their own body (up to 2 MB); app.ts skips the default 100 KB parser for this router
documentsRouter.post("/", express.json({ limit: "2mb" }), validateBodyMiddleware(createDocumentSchema), createDocument);
documentsRouter.delete("/:id", deleteDocument);
