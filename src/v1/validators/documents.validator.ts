import Joi from "joi";
import { MAX_DOCUMENT_CHARS } from "../config/limits.config.js";

export interface CreateDocumentInput {
    filename: string;
    text: string;
}

// The browser extracts the text from the file; the API never receives the file itself.
// The text is not trimmed here: the service cleans it (sanitizeText) before chunking.
export const createDocumentSchema = Joi.object<CreateDocumentInput>({
    filename: Joi.string().normalize("NFC").trim().min(1).max(255).required().messages({
        "string.base": "Filename must be a string",
        "string.empty": "Filename cannot be empty",
        "string.max": "Filename cannot have more than {#limit} characters",
        "any.required": "Filename is required"
    }),
    text: Joi.string().max(MAX_DOCUMENT_CHARS).required().messages({
        "string.base": "Text must be a string",
        "string.empty": "Text cannot be empty",
        "string.max": "Text cannot have more than {#limit} characters",
        "any.required": "Text is required"
    })
});
