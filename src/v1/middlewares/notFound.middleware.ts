import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.util.js";

export const notFoundMiddleware = (req: Request, res: Response, next: NextFunction) => {
    next(new AppError(404, "Route not found"));
};
