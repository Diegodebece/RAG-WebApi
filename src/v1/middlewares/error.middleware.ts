import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.util.js";

// errors raised by Express/body-parser for bad client input (e.g. malformed JSON)
const isClientError = (err: unknown): err is Error & { status: number } =>
    err instanceof Error
    && "expose" in err && err.expose === true
    && "status" in err && typeof err.status === "number" && err.status < 500;

export const errorMiddleware = (err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof AppError) {
        const response: { message: string; details?: string[] } = { message: err.message };
        if (err.details) {
            response.details = err.details;
        }
        return res.status(err.status).json(response);
    }

    if (isClientError(err)) {
        return res.status(err.status).json({ message: err.message });
    }

    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
};
