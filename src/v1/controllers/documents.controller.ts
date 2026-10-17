import type { Request, Response, NextFunction } from "express";
import {
    createDocumentService,
    deleteDocumentService,
    getDocumentByIdService,
    getDocumentsService
} from "../services/documents.service.js";
import type { CreateDocumentInput } from "../validators/documents.validator.js";

export const getDocuments = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const documents = await getDocumentsService(req.decoded!.id);
        return res.status(200).json({ success: true, message: "Documents retrieved successfully", data: documents });
    } catch (error) {
        next(error);
    }
};

export const getDocumentById = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const document = await getDocumentByIdService(req.decoded!.id, id);
        return res.status(200).json({ success: true, message: "Document retrieved successfully", data: document });
    } catch (error) {
        next(error);
    }
};

// 202 Accepted instead of 201: the document exists, but it can be used only after the indexing job finishes.
export const createDocument = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const created = await createDocumentService(req.decoded!.id, req.validatedBody as CreateDocumentInput);
        return res.status(202).json({ success: true, message: "Document accepted for indexing", data: created });
    } catch (error) {
        next(error);
    }
};

export const deleteDocument = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        await deleteDocumentService(req.decoded!.id, id);
        return res.status(200).json({ success: true, message: "Document deleted successfully" });
    } catch (error) {
        next(error);
    }
};
