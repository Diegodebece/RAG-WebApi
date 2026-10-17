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

// The body is parsed after the per-address limits (they do not need it) and before the per-email limit,
// which reads the email from it.

authRouter.post(
    "/register",
    rateLimitMiddleware({ limit: REGISTRATION_ATTEMPTS_PER_HOUR, windowMs: REGISTRATION_WINDOW_MS, keyBy: "ip" }),
    rateLimitMiddleware({ limit: REGISTRATIONS_PER_HOUR, windowMs: REGISTRATION_WINDOW_MS, keyBy: "ip", onlySuccesses: true }),
    express.json(),
    validateBodyMiddleware(registerUserSchema),
    registerUser
);

authRouter.post(
    "/login",
    rateLimitMiddleware({ limit: LOGINS_PER_15_MINUTES, windowMs: LOGIN_WINDOW_MS, keyBy: "ip" }),
    express.json(),
    rateLimitMiddleware({ limit: FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES, windowMs: LOGIN_WINDOW_MS, keyBy: "emailAndIp", onlyFailures: true }),
    validateBodyMiddleware(loginUserSchema),
    loginUser
);
