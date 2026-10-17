import Joi from "joi";
import { MAX_DOCUMENT_CHARS } from "../config/limits.config.js";

export interface CreateDocumentInput {
    filename: string;
    text: string;
}

// Characters a filename must not contain, as code point ranges: control characters (a null byte makes
// PostgreSQL reject the row) and the invisible marks that reverse the direction of text, which can make
// "invoice[U+202E]txt.exe" display as "invoiceexe.txt". Built from numbers so no invisible character
// has to appear in this file.
const FORBIDDEN_FILENAME_RANGES: [number, number][] = [
    [0x0000, 0x001f], [0x007f, 0x009f], [0x061c, 0x061c], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]
];
const toRegexRange = ([from, to]: [number, number]): string => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`;
const FORBIDDEN_FILENAME_CHARACTERS = new RegExp(`[${FORBIDDEN_FILENAME_RANGES.map(toRegexRange).join("")}]`, "u");

// The browser extracts the text from the file; the API never receives the file itself.
// The text is not trimmed here: the service cleans it (sanitizeText) before chunking.
export const createDocumentSchema = Joi.object<CreateDocumentInput>({
    filename: Joi.string().normalize("NFC").trim().min(1).max(255).pattern(FORBIDDEN_FILENAME_CHARACTERS, { invert: true }).required().messages({
        "string.base": "Filename must be a string",
        "string.empty": "Filename cannot be empty",
        "string.max": "Filename cannot have more than {#limit} characters",
        "string.pattern.invert.base": "Filename contains control or text-direction characters",
        "any.required": "Filename is required"
    }),
    text: Joi.string().max(MAX_DOCUMENT_CHARS).required().messages({
        "string.base": "Text must be a string",
        "string.empty": "Text cannot be empty",
        "string.max": "Text cannot have more than {#limit} characters",
        "any.required": "Text is required"
    })
});
