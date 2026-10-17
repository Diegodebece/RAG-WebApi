import type { JobEvent } from "../types/jobs.type.js";

type JobEventListener = (event: JobEvent) => void;

// Observer: listeners receive every job event (the log now, the SSE stream later). It lives apart from the
// queue, so adding a listener never means touching the code that runs the jobs.
const listeners = new Set<JobEventListener>();

// Returns the function that unsubscribes the listener.
export const subscribeToJobEvents = (listener: JobEventListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// A failing listener must not stop the queue or the other listeners.
export const emitJobEvent = (event: JobEvent): void => {
    for (const listener of listeners) {
        try {
            listener(event);
        } catch (error) {
            console.error("A job event listener failed", error);
        }
    }
};
