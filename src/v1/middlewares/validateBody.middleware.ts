import type { Request, Response, NextFunction } from "express";
import type { ObjectSchema } from "joi";
import { AppError } from "../utils/appError.util.js";

export const validateBodyMiddleware = (schema: ObjectSchema) => (req: Request, res: Response, next: NextFunction) => {
    // Express 5 leaves req.body undefined when the request has no body, and Joi accepts undefined for an
    // object schema; validating an empty object instead reports the missing required fields.
    const { error, value } = schema.validate(req.body ?? {}, { abortEarly: false });

    if (error) {
        const details = error.details.map((detail) => detail.message);
        return next(new AppError(400, "Validation error", details));
    }

    req.validatedBody = value;
    next();
};
