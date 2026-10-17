import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/appError.util.js";

// Errors raised by libraries for bad client input carry a 4xx status: malformed JSON from body-parser, or a path
// parameter the router cannot decode (a URIError). The status is the answer; the message is shown only when the
// library marks it safe (expose), because a message like the router's can mention internal details.
const getClientErrorStatus = (err: unknown): number | null =>
    err instanceof Error && "status" in err && typeof err.status === "number" && err.status >= 400 && err.status < 500
        ? err.status
        : null;

const isExposed = (err: unknown): boolean => err instanceof Error && "expose" in err && err.expose === true;

export const errorMiddleware = (err: unknown, req: Request, res: Response, next: NextFunction) => {
    // Part of the response is already out (for example a stream): another status or body cannot be sent.
    // Express default handler closes the connection instead.
    if (res.headersSent) {
        return next(err);
    }

    if (err instanceof AppError) {
        const response: { message: string; details?: string[] } = { message: err.message };
        if (err.details) {
            response.details = err.details;
        }
        return res.status(err.status).json(response);
    }

    const clientErrorStatus = getClientErrorStatus(err);

    if (clientErrorStatus !== null) {
        return res.status(clientErrorStatus).json({ message: isExposed(err) && err instanceof Error ? err.message : "Invalid request" });
    }

    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
};
