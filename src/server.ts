import { app } from "./app.js";
import { getStartupConfigProblems } from "./v1/config/env.config.js";
import { CLEANUP_INTERVAL_MS } from "./v1/config/limits.config.js";
import { deleteExpiredDataService } from "./v1/services/cleanup.service.js";
import { subscribeToJobEvents } from "./v1/services/jobEvents.service.js";
import { recoverJobsService, startJobWorkerService } from "./v1/services/jobQueue.service.js";
import { runWithModelTurnService } from "./v1/services/modelTurn.service.js";
import { loadModelsService } from "./v1/services/ollama.service.js";
import { ModelUnavailableError } from "./v1/utils/modelUnavailableError.util.js";

const PORT = Number(process.env.PORT) || 3000;

// 127.0.0.1 keeps the API reachable from this computer only; inside Docker HOST must be 0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";

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
subscribeToJobEvents((event) => {
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
    setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS);
};

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    void startBackgroundWork();
});
