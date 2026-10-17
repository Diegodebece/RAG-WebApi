import type { Server } from "node:http";

// Stops the HTTP server without cutting the requests in progress: it stops accepting connections, closes the idle
// ones, ends the event streams (they would never finish on their own) and waits for the requests still running.
// Whatever is left after timeoutMs is closed, so the process always gets to exit.
export const closeServerGracefully = async (server: Server, endStreams: () => void, timeoutMs: number): Promise<void> => {
    const closed = new Promise<void>((resolve) => {
        server.close(() => resolve());
    });

    server.closeIdleConnections();
    endStreams();

    const forceClose = setTimeout(() => server.closeAllConnections(), timeoutMs);
    await closed;
    clearTimeout(forceClose);
};
