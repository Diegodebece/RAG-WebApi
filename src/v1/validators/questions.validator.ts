import Joi from "joi";
import { MAX_QUESTION_CHARS } from "../config/limits.config.js";
import type { AnswerLanguage, AnswerMode } from "../types/answers.type.js";

// mode and language are optional; the service answers in baseline mode and in English when they are missing
export interface AskQuestionInput {
    question: string;
    mode?: AnswerMode;
    language?: AnswerLanguage;
}

export const askQuestionSchema = Joi.object<AskQuestionInput>({
    question: Joi.string().trim().min(1).max(MAX_QUESTION_CHARS).required().messages({
        "string.base": "Question must be a string",
        "string.empty": "Question cannot be empty",
        "string.max": "Question cannot have more than {#limit} characters",
        "any.required": "Question is required"
    }),
    mode: Joi.string().valid("baseline", "structured").messages({
        "string.base": "Mode must be a string",
        "any.only": "Mode must be baseline or structured"
    }),
    language: Joi.string().valid("en", "es").messages({
        "string.base": "Language must be a string",
        "any.only": "Language must be en or es"
    })
});
