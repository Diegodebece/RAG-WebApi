import { app } from "./app.js";
import { getStartupConfigProblems } from "./v1/config/env.config.js";
import { CLEANUP_INTERVAL_MS } from "./v1/config/limits.config.js";
import { deleteExpiredDataService } from "./v1/services/cleanup.service.js";

const PORT = Number(process.env.PORT) || 3000;

// 127.0.0.1 keeps the API reachable from this computer only; inside Docker HOST must be 0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";

const problems = getStartupConfigProblems(process.env);

if (problems.length > 0) {
    console.error(`Cannot start the server:\n- ${problems.join("\n- ")}`);
    process.exit(1);
}

// Deletes expired documents and old question records; a failure is logged and retried on the next run.
const runCleanup = async (): Promise<void> => {
    try {
        const removed = await deleteExpiredDataService();

        if (removed.documents > 0 || removed.questionUsage > 0) {
            console.log(`Cleanup: ${removed.documents} expired document(s), ${removed.questionUsage} old question record(s)`);
        }
    } catch (error) {
        console.error("Cleanup failed", error);
    }
};

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    void runCleanup();
    setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS);
});
