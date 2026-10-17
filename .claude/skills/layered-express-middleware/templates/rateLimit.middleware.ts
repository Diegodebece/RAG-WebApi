import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../utils/appError.util.js";

interface RateLimitOptions {
    limit: number;
    windowMs: number;
    // "ip": one counter per client address; "email": one counter per email in the request body
    keyBy: "ip" | "email";
    // count only requests that end in an error response, such as failed logins
    onlyFailures?: boolean;
}

// ipKeyGenerator groups IPv6 addresses by network, so one client cannot dodge the limit by changing addresses.
// Behind Cloudflare, req.ip must come from CF-Connecting-IP; that is configured with the tunnel (deployment step).
const clientAddressKey = (req: Request): string => ipKeyGenerator(req.ip ?? "unknown");

// Email limits read the raw body, so they must run after express.json(). Without an email, the address is the key.
const emailKey = (req: Request): string => {
    const email: unknown = req.body?.email;

    return typeof email === "string" && email.trim() !== ""
        ? `email:${email.trim().toLowerCase()}`
        : clientAddressKey(req);
};

// Counters live in memory: they reset when the API restarts, which is acceptable for short windows.
// Daily quotas that must survive restarts are counted in the database instead.
export const rateLimitMiddleware = (options: RateLimitOptions) => rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: options.onlyFailures ?? false,
    keyGenerator: options.keyBy === "email" ? emailKey : clientAddressKey,
    // hand the error to errorMiddleware, so a 429 has the same { message } body as every other error
    handler: (req, res, next) => next(new AppError(429, "Too many requests, please try again later"))
});
