import type { Request, Response, NextFunction } from "express";
import { EVENT_STREAM_HEARTBEAT_SECONDS } from "../config/limits.config.js";
import { openEventStreamService } from "../services/eventStreams.service.js";
import { requireTokenExpiry, requireUserId } from "../utils/requireUserId.util.js";
import { formatSseComment, formatSseEvent } from "../utils/sse.util.js";

// setTimeout fires at once for longer delays (about 24.8 days)
const MAX_TIMER_MS = 2_147_483_647;

// The live stream of the user's events (Server-Sent Events). Unlike the other controllers, it writes the
// response over time instead of sending one JSON body. It ends when the browser disconnects, or when the
// token expires: a token cannot be revoked, so its expiry is the longest a stream may stay open.
export const streamEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const expiresAt = requireTokenExpiry(req);

        // before the headers go out, so a refused stream (too many open) gets the usual error response
        const closeStream = openEventStreamService(userId, (event) => {
            res.write(formatSseEvent(event));
        });

        res.status(200).set({
            "Content-Type": "text/event-stream; charset=utf-8",
            Connection: "keep-alive",
            // tells proxies such as nginx not to hold the events back in a buffer
            "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        res.write(formatSseComment("connected"));

        const heartbeat = setInterval(() => res.write(formatSseComment("heartbeat")), EVENT_STREAM_HEARTBEAT_SECONDS * 1000);
        const expiry = setTimeout(() => res.end(), Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_MS));

        res.on("close", () => {
            clearInterval(heartbeat);
            clearTimeout(expiry);
            closeStream();
        });
    } catch (error) {
        next(error);
    }
};
