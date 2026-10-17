import type { LiveEvent } from "../types/events.type.js";

// One Server-Sent Events message: the event's type as its name and the rest as JSON on a single line
// (JSON.stringify escapes line breaks). The userId is left out: the stream only carries the reader's own events.
export const formatSseEvent = (event: LiveEvent): string => {
    const data: Record<string, unknown> = { ...event };
    delete data.userId;
    delete data.type;
    return `event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`;
};

// A comment: clients ignore it, but it keeps proxies and the browser from closing an idle connection.
export const formatSseComment = (text: string): string => `: ${text}\n\n`;
