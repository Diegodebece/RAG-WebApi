import type { Request, Response, NextFunction } from "express";
import { getHealthService } from "../services/health.service.js";

// Always 200 when the API answers: the state of each dependency is in data.status. A request that gets no
// answer at all (or a Cloudflare error) means the API itself is offline.
export const getHealth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const report = await getHealthService();
        return res.status(200).json({ success: true, message: "Health check completed", data: report });
    } catch (error) {
        next(error);
    }
};
