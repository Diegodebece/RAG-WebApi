import type { Request, Response, NextFunction } from "express";
import { getSecretKey } from "../config/auth.config.js";
import { AppError } from "../utils/appError.util.js";
import { verifyToken } from "../utils/token.util.js";

export const authenticateMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");

    if (scheme !== "Bearer" || !token) {
        return next(new AppError(401, "Authentication token is missing"));
    }

    const secretKey = getSecretKey();

    // a missing secret is a server misconfiguration, not a client error: let errorMiddleware answer 500
    if (!secretKey) {
        return next(new Error("SECRET_KEY is not set"));
    }

    const payload = verifyToken(token, secretKey);

    if (!payload) {
        return next(new AppError(401, "Invalid or expired authentication token"));
    }

    req.decoded = payload;
    next();
};
