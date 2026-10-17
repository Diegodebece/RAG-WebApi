import type { Request, Response, NextFunction } from "express";

// Every response is private JSON: nothing should be cached, sniffed as another type, run as a page or
// framed by another site. Set before any route, so error responses carry the headers too.
const SECURITY_HEADERS: Record<string, string> = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY"
};

export const securityHeadersMiddleware = (req: Request, res: Response, next: NextFunction) => {
    res.set(SECURITY_HEADERS);
    next();
};
