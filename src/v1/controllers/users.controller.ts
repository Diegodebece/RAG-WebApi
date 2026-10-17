import type { Request, Response, NextFunction } from "express";
import { getCurrentUserService } from "../services/users.service.js";
import { requireUserId } from "../utils/requireUserId.util.js";

export const getCurrentUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = await getCurrentUserService(requireUserId(req));
        return res.status(200).json({ success: true, message: "Current user retrieved successfully", data: user });
    } catch (error) {
        next(error);
    }
};
