import type { Request } from "express";
import { AppError } from "./appError.util.js";

// The logged-in user's id, for controllers behind authenticateMiddleware. If a router is ever mounted
// without it, the request gets a 401 instead of a crash (and a 500) on an undefined req.decoded.
export const requireUserId = (req: Pick<Request, "decoded">): string => {
    if (!req.decoded) {
        throw new AppError(401, "Authentication required");
    }

    return req.decoded.id;
};

// When the logged-in user's token expires (milliseconds since 1970), with the same 401 when there is none.
export const requireTokenExpiry = (req: Pick<Request, "decoded">): number => {
    if (!req.decoded) {
        throw new AppError(401, "Authentication required");
    }

    return req.decoded.expiresAt;
};
