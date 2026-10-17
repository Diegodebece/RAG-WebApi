import type { Request, Response, NextFunction } from "express";
import { EVENT_STREAM_HEARTBEAT_SECONDS } from "../config/limits.config.js";
import { openEventStreamService } from "../services/eventStreams.service.js";
import { getClientAddress } from "../utils/clientAddress.util.js";
import { requireTokenExpiry, requireUserId } from "../utils/requireUserId.util.js";
import { formatSseComment, formatSseEvent } from "../utils/sse.util.js";

// setTimeout fires at once for longer delays (about 24.8 days)
const MAX_TIMER_MS = 2_147_483_647;

// The live stream of the user's events (Server-Sent Events). Unlike the other controllers, it writes the
// response over time instead of sending one JSON body. It ends when the browser disconnects, when the server
// shuts down, or when the token expires: a token cannot be revoked, so its expiry is the longest a stream may
// stay open.
export const streamEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = requireUserId(req);
        const expiresAt = requireTokenExpiry(req);
        let heartbeat: NodeJS.Timeout | undefined;
        let expiry: NodeJS.Timeout | undefined;

        // nothing is written once the response has ended, even by an event or heartbeat already on its way
        const write = (chunk: string): void => {
            if (!res.writableEnded) {
                res.write(chunk);
            }
        };

        // Stops everything this stream started. Runs when the connection closes, and before the server ends the
        // response itself, so no timer or event can write in between.
        const cleanUp = (): void => {
            clearInterval(heartbeat);
            clearTimeout(expiry);
            closeStream();
        };

        const finish = (): void => {
            cleanUp();
            res.end();
        };

        // before the headers go out, so a refused stream (too many open) gets the usual error response
        const closeStream = openEventStreamService({
            userId,
            clientAddress: getClientAddress(req),
            send: (event) => write(formatSseEvent(event)),
            end: finish
        });

        res.status(200).set({
            "Content-Type": "text/event-stream; charset=utf-8",
            Connection: "keep-alive",
            // tells proxies such as nginx not to hold the events back in a buffer
            "X-Accel-Buffering": "no"
        });
        res.flushHeaders();
        write(formatSseComment("connected"));

        heartbeat = setInterval(() => write(formatSseComment("heartbeat")), EVENT_STREAM_HEARTBEAT_SECONDS * 1000);
        expiry = setTimeout(finish, Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_MS));

        res.on("close", cleanUp);
        res.on("error", (error) => console.error("An event stream failed", error));
    } catch (error) {
        next(error);
    }
};
