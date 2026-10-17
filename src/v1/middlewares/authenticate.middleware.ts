import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/appError.util.js";
import type { TokenPayload } from "../types/auth.type.js";

export const authenticateMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");

    if (scheme !== "Bearer" || !token) {
        return next(new AppError(401, "Authentication token is missing"));
    }

    const secretKey = process.env.SECRET_KEY;

    // a missing secret is a server misconfiguration, not a client error: let errorMiddleware answer 500
    if (!secretKey) {
        return next(new Error("SECRET_KEY is not set"));
    }

    try {
        // only accept the algorithm our tokens are signed with
        req.decoded = jwt.verify(token, secretKey, { algorithms: ["HS256"] }) as TokenPayload;
        next();
    } catch (error) {
        next(new AppError(401, "Invalid or expired authentication token"));
    }
};
