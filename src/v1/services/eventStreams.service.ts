import { MAX_EVENT_STREAMS, MAX_EVENT_STREAMS_PER_ADDRESS, MAX_EVENT_STREAMS_PER_USER } from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import { subscribeToEvents } from "./events.service.js";
import type { LiveEvent } from "../types/events.type.js";

interface EventStreamOptions {
    userId: string;
    // the client's address as a limit key (getClientAddress)
    clientAddress: string;
    // writes one event to the stream
    send: (event: LiveEvent) => void;
    // ends the response, when the server shuts down
    end: () => void;
}

// Open streams, counted in memory like the streams themselves: all of it is gone when the API restarts.
const streamsPerUser = new Map<string, number>();
const streamsPerAddress = new Map<string, number>();
const openStreams = new Set<{ end: () => void }>();

const addOne = (counts: Map<string, number>, key: string): void => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
};

const removeOne = (counts: Map<string, number>, key: string): void => {
    const remaining = (counts.get(key) ?? 1) - 1;

    if (remaining > 0) {
        counts.set(key, remaining);
    } else {
        counts.delete(key);
    }
};

// Registers a live stream and passes it only its user's events. Each stream holds a connection, so they are
// capped per user and per address (429: close one first), and for everyone together (503: the server is full).
// The cap per address keeps a few accounts from one place from taking every stream. Returns the function that
// closes the stream; calling it more than once does nothing.
export const openEventStreamService = ({ userId, clientAddress, send, end }: EventStreamOptions): (() => void) => {
    if ((streamsPerUser.get(userId) ?? 0) >= MAX_EVENT_STREAMS_PER_USER) {
        throw new AppError(429, `Too many open event streams for this account (${MAX_EVENT_STREAMS_PER_USER}): close one first`);
    }

    if ((streamsPerAddress.get(clientAddress) ?? 0) >= MAX_EVENT_STREAMS_PER_ADDRESS) {
        throw new AppError(429, `Too many open event streams from this address (${MAX_EVENT_STREAMS_PER_ADDRESS}): close one first`);
    }

    if (openStreams.size >= MAX_EVENT_STREAMS) {
        throw new AppError(503, "The server is busy, please try again in a few minutes");
    }

    const stream = { end };
    addOne(streamsPerUser, userId);
    addOne(streamsPerAddress, clientAddress);
    openStreams.add(stream);

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
        openStreams.delete(stream);
        removeOne(streamsPerUser, userId);
        removeOne(streamsPerAddress, clientAddress);
    };
};

// Ends every open stream, when the server shuts down; each one then cleans itself up.
export const closeAllEventStreamsService = (): void => {
    for (const stream of [...openStreams]) {
        stream.end();
    }
};
