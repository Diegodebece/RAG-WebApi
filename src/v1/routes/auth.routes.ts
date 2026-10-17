import express from "express";
import { loginUser, registerUser } from "../controllers/auth.controller.js";
import { rateLimitMiddleware } from "../middlewares/rateLimit.middleware.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { loginUserSchema, registerUserSchema } from "../validators/auth.validator.js";
import {
    FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES,
    LOGIN_WINDOW_MS,
    LOGINS_PER_15_MINUTES,
    REGISTRATION_ATTEMPTS_PER_HOUR,
    REGISTRATION_WINDOW_MS,
    REGISTRATIONS_PER_HOUR
} from "../config/limits.config.js";

export const authRouter = express.Router({ mergeParams: true });

authRouter.post(
    "/register",
    rateLimitMiddleware({ limit: REGISTRATION_ATTEMPTS_PER_HOUR, windowMs: REGISTRATION_WINDOW_MS, keyBy: "ip" }),
    rateLimitMiddleware({ limit: REGISTRATIONS_PER_HOUR, windowMs: REGISTRATION_WINDOW_MS, keyBy: "ip", onlySuccesses: true }),
    validateBodyMiddleware(registerUserSchema),
    registerUser
);

authRouter.post(
    "/login",
    rateLimitMiddleware({ limit: LOGINS_PER_15_MINUTES, windowMs: LOGIN_WINDOW_MS, keyBy: "ip" }),
    rateLimitMiddleware({ limit: FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES, windowMs: LOGIN_WINDOW_MS, keyBy: "email", onlyFailures: true }),
    validateBodyMiddleware(loginUserSchema),
    loginUser
);
