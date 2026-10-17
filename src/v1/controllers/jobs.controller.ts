import type { Request, Response, NextFunction } from "express";
import { getJobByIdService } from "../services/jobs.service.js";
import { requireUserId } from "../utils/requireUserId.util.js";

export const getJobById = async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const job = await getJobByIdService(requireUserId(req), id);
        return res.status(200).json({ success: true, message: "Job retrieved successfully", data: job });
    } catch (error) {
        next(error);
    }
};
