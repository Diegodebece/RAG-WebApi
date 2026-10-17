import type { LiveEvent } from "../types/events.type.js";

type LiveEventListener = (event: LiveEvent) => void;

// Observer: listeners receive every live event (the log and the event streams of the browsers). It lives
// apart from the code that produces the events, so adding a listener never means touching the queue.
const listeners = new Set<LiveEventListener>();

// Returns the function that unsubscribes the listener.
export const subscribeToEvents = (listener: LiveEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// A failing listener must not stop the queue or the other listeners.
export const emitEvent = (event: LiveEvent): void => {
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            console.error("An event listener failed", error);
        }
    }
};
