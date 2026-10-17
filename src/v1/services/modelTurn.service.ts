import { AppError } from "../utils/appError.util.js";
import { RequestCancelledError } from "../utils/requestCancelledError.util.js";

interface TurnOptions {
    // give up with a 503 when the turn has not come after this long
    maxWaitMs?: number;
    // leave the line when the caller no longer needs the turn (the browser disconnected)
    signal?: AbortSignal;
    // told the caller's place in line (1 = next) when it joins and every time it moves up
    onPosition?: (position: number) => void;
}

interface Waiter {
    start: () => void;
    onPosition?: (position: number) => void;
    // the place it was last told, 0 before joining
    position: number;
}

const BUSY_MESSAGE = "The server is busy, please try again in a few minutes";

// One Ollama request at a time for the whole API, first come first served. Indexing takes a turn per batch of
// chunks and a question one turn for its whole answer, so a question waits for at most one batch, never for
// a whole document. While nobody holds the turn, the line is empty.
let busy = false;
const line: Waiter[] = [];

// Tells every waiter whose place changed its new position.
const announcePositions = (): void => {
    line.forEach((waiter, index) => {
        if (waiter.position !== index + 1) {
            waiter.position = index + 1;
            waiter.onPosition?.(waiter.position);
        }
    });
};

// Hands the turn straight to the next caller in line, or frees it.
const releaseTurn = (): void => {
    const next = line.shift();

    if (next) {
        next.start();
        announcePositions();
    } else {
        busy = false;
    }
};

const waitForTurn = (options: TurnOptions): Promise<void> => {
    if (options.signal?.aborted) {
        return Promise.reject(new RequestCancelledError());
    }

    if (!busy) {
        busy = true;
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        let timer: NodeJS.Timeout | undefined;

        const stopWaiting = (): void => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
        };

        const leaveLine = (error: AppError): void => {
            const position = line.indexOf(waiter);

            if (position !== -1) {
                line.splice(position, 1);
                announcePositions();
            }

            stopWaiting();
            reject(error);
        };

        const onAbort = (): void => leaveLine(new RequestCancelledError());

        const waiter: Waiter = {
            start: () => {
                stopWaiting();
                resolve();
            },
            onPosition: options.onPosition,
            position: 0
        };

        if (options.maxWaitMs !== undefined) {
            timer = setTimeout(() => leaveLine(new AppError(503, BUSY_MESSAGE)), options.maxWaitMs);
        }

        options.signal?.addEventListener("abort", onAbort, { once: true });
        line.push(waiter);
        announcePositions();
    });
};

// Runs the task when its turn comes and passes the turn on when it ends, also when it fails.
export const runWithModelTurnService = async <T>(task: () => Promise<T>, options: TurnOptions = {}): Promise<T> => {
    await waitForTurn(options);

    try {
        return await task();
    } finally {
        releaseTurn();
    }
};

// callers waiting for the turn, not counting the one that holds it
export const getModelTurnWaitingCount = (): number => line.length;
