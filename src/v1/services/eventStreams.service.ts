import { MAX_EVENT_STREAMS, MAX_EVENT_STREAMS_PER_USER } from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import { subscribeToEvents } from "./events.service.js";
import type { LiveEvent } from "../types/events.type.js";

// Open streams, counted in memory like the streams themselves: both are gone when the API restarts.
const streamsPerUser = new Map<string, number>();
let openStreams = 0;

// Registers a live stream for a user and passes only that user's events to send. Each stream holds a
// connection, so their number is capped per user (429) and for all users together (503, the server is
// full). Returns the function that closes the stream; calling it more than once does nothing.
export const openEventStreamService = (userId: string, send: (event: LiveEvent) => void): (() => void) => {
    const userStreams = streamsPerUser.get(userId) ?? 0;

    if (userStreams >= MAX_EVENT_STREAMS_PER_USER) {
        throw new AppError(429, `Too many open event streams for this account (${MAX_EVENT_STREAMS_PER_USER}): close one first`);
    }

    if (openStreams >= MAX_EVENT_STREAMS) {
        throw new AppError(503, "The server is busy, please try again in a few minutes");
    }

    streamsPerUser.set(userId, userStreams + 1);
    openStreams++;

    const unsubscribe = subscribeToEvents((event) => {
        if (event.userId === userId) {
            send(event);
        }
    });
    let closed = false;

    return () => {
        if (closed) {
            return;
        }

        closed = true;
        unsubscribe();
        openStreams--;
        const remaining = (streamsPerUser.get(userId) ?? 1) - 1;

        if (remaining > 0) {
            streamsPerUser.set(userId, remaining);
        } else {
            streamsPerUser.delete(userId);
        }
    };
};
