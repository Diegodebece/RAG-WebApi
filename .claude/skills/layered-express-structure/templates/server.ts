import { app } from "./app.js";
import { closeServerGracefully } from "./shutdown.js";
import { pool } from "./v1/config/db.config.js";
import { HOST, PORT } from "./v1/config/server.config.js";

// Docker waits 10 seconds after SIGTERM before killing the container
const SHUTDOWN_TIMEOUT_MS = 9_000;

const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});

// On docker stop (SIGTERM) or Ctrl+C (SIGINT): stop background work, let the requests in progress finish, then
// close the database. Pass a function that ends long-lived responses (event streams), if the API has any.
const shutDown = async (signal: string): Promise<void> => {
    console.log(`${signal} received: finishing the requests in progress`);

    try {
        await closeServerGracefully(server, () => {}, SHUTDOWN_TIMEOUT_MS);
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error("Could not shut down cleanly", error);
        process.exit(1);
    }
};

process.once("SIGTERM", () => void shutDown("SIGTERM"));
process.once("SIGINT", () => void shutDown("SIGINT"));
