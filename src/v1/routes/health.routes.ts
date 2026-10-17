import express from "express";
import { HEALTH_CHECKS_PER_MINUTE, HEALTH_WINDOW_MS } from "../config/limits.config.js";
import { getHealth } from "../controllers/health.controller.js";
import { rateLimitMiddleware } from "../middlewares/rateLimit.middleware.js";

export const healthRouter = express.Router({ mergeParams: true });

healthRouter.get("/", rateLimitMiddleware({ limit: HEALTH_CHECKS_PER_MINUTE, windowMs: HEALTH_WINDOW_MS, keyBy: "ip" }), getHealth);
