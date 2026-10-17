import type { Request } from "express";
import { rateLimit } from "express-rate-limit";
import { AppError } from "../utils/appError.util.js";
import { getClientAddress } from "../utils/clientAddress.util.js";

interface RateLimitOptions {
    limit: number;
    windowMs: number;
    // "ip": one counter per client address; "emailAndIp": one counter per email in the request body and address;
    // "user": one counter per logged-in user, for routes behind authenticateMiddleware
    keyBy: "ip" | "emailAndIp" | "user";
    // count only requests that end in an error response, such as failed logins
    onlyFailures?: boolean;
    // count only requests that succeed, such as accounts actually created
    onlySuccesses?: boolean;
}

// one counter per client address; behind the tunnel, the address Cloudflare reported (see getClientAddress)
const clientAddressKey = (req: Request): string => getClientAddress(req);

// Counting per email *and* address stops guessing one account from one address, without letting someone
// else lock the owner out by failing on purpose from another address. Email limits read the raw body, so they
// must run after express.json(). The email is normalized like the validator does (NFC, trimmed, lowercased),
// so every spelling of one address shares a counter. Without an email, the address alone is the key.
const emailAndIpKey = (req: Request): string => {
    const email: unknown = req.body?.email;

    return typeof email === "string" && email.trim() !== ""
        ? `email:${email.normalize("NFC").trim().toLowerCase()}|${clientAddressKey(req)}`
        : clientAddressKey(req);
};

// A user keeps one counter whatever address they use. Without a logged-in user (a route mounted outside the
// protected section by mistake), the address is the key, so the limit still applies.
const userKey = (req: Request): string => (req.decoded ? `user:${req.decoded.id}` : clientAddressKey(req));

const KEY_GENERATORS: Record<RateLimitOptions["keyBy"], (req: Request) => string> = {
    ip: clientAddressKey,
    emailAndIp: emailAndIpKey,
    user: userKey
};

// Counters live in memory: they reset when the API restarts, which is acceptable for short windows.
// Daily quotas that must survive restarts are counted in the database instead.
export const rateLimitMiddleware = (options: RateLimitOptions) => rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: options.onlyFailures ?? false,
    skipFailedRequests: options.onlySuccesses ?? false,
    keyGenerator: KEY_GENERATORS[options.keyBy],
    // hand the error to errorMiddleware, so a 429 has the same { message } body as every other error
    handler: (req, res, next) => next(new AppError(429, "Too many requests, please try again later"))
});
