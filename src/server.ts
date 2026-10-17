import { app } from "./app.js";
import { closeServerGracefully } from "./shutdown.js";
import { pool } from "./v1/config/db.config.js";
import { getStartupConfigProblems } from "./v1/config/env.config.js";
import { CLEANUP_INTERVAL_MS } from "./v1/config/limits.config.js";
import { HOST, PORT } from "./v1/config/server.config.js";
import { deleteExpiredDataService } from "./v1/services/cleanup.service.js";
import { subscribeToEvents } from "./v1/services/events.service.js";
import { closeAllEventStreamsService } from "./v1/services/eventStreams.service.js";
import { recoverJobsService, startJobWorkerService, stopJobWorkerService } from "./v1/services/jobQueue.service.js";
import { runWithModelTurnService } from "./v1/services/modelTurn.service.js";
import { loadModelsService } from "./v1/services/ollama.service.js";
import { ModelUnavailableError } from "./v1/utils/modelUnavailableError.util.js";

// Docker waits 10 seconds after SIGTERM before killing the container
const SHUTDOWN_TIMEOUT_MS = 9_000;

let cleanupTimer: NodeJS.Timeout | undefined;

const problems = getStartupConfigProblems(process.env);

if (problems.length > 0) {
    console.error(`Cannot start the server:\n- ${problems.join("\n- ")}`);
    process.exit(1);
}

// Deletes expired documents and old upload and question records; a failure is logged and retried on the next run.
const runCleanup = async (): Promise<void> => {
    try {
        const removed = await deleteExpiredDataService();

        if (removed.documents > 0 || removed.uploadUsage > 0 || removed.questionUsage > 0) {
            console.log(`Cleanup: ${removed.documents} expired document(s), ${removed.uploadUsage + removed.questionUsage} old usage record(s)`);
        }
    } catch (error) {
        console.error("Cleanup failed", error);
    }
};

// one observer of the job queue: the log (the SSE stream will be another)
subscribeToEvents((event) => {
    if (event.type === "done") {
        console.log(`Job ${event.jobId}: document ${event.documentId} indexed`);
    } else if (event.type === "failed") {
        console.log(`Job ${event.jobId} failed: ${event.error}`);
    }
});

// Jobs interrupted by the last shutdown go back to the queue before the worker starts.
// Right after the laptop boots, Ollama needs over a minute to load the answer model the first time; loading
// both models when the API starts means nobody waits for that. It takes the turn with the model like any
// other request. If Ollama is not running yet, the first request loads the models instead.
const loadModels = async (): Promise<void> => {
    const started = Date.now();

    try {
        await runWithModelTurnService(loadModelsService);
        console.log(`Models loaded in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (error) {
        if (error instanceof ModelUnavailableError) {
            console.log("Ollama is not running yet; the models will load with the first request");
        } else {
            console.error("Could not load the models", error);
        }
    }
};

const startBackgroundWork = async (): Promise<void> => {
    try {
        const recovered = await recoverJobsService();

        if (recovered > 0) {
            console.log(`Resuming ${recovered} interrupted indexing job(s)`);
        }
    } catch (error) {
        console.error("Could not recover interrupted jobs", error);
    }

    // before the worker, so the models are loaded before a resumed job needs them
    void loadModels();
    startJobWorkerService();
    void runCleanup();
    cleanupTimer = setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS);
};

const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    void startBackgroundWork();
});

// On docker stop (SIGTERM) or Ctrl+C (SIGINT): no new work, let the requests in progress finish, then close the
// database. An indexing batch cut short stays "processing" and is resumed on the next start.
const shutDown = async (signal: string): Promise<void> => {
    console.log(`${signal} received: finishing the requests in progress`);
    stopJobWorkerService();
    clearInterval(cleanupTimer);

    try {
        await closeServerGracefully(server, closeAllEventStreamsService, SHUTDOWN_TIMEOUT_MS);
        await pool.end();
        console.log("Server stopped");
        process.exit(0);
    } catch (error) {
        console.error("Could not shut down cleanly", error);
        process.exit(1);
    }
};

process.once("SIGTERM", () => void shutDown("SIGTERM"));
process.once("SIGINT", () => void shutDown("SIGINT"));
