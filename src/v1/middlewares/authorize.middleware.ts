import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.util.js";

export const authorizeMiddleware = (roles: string[] = []) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.decoded) {
        return next(new AppError(401, "Authentication required"));
    }

    if (!roles.includes(req.decoded.role)) {
        return next(new AppError(403, "You do not have permission to perform this action"));
    }

    next();
};
