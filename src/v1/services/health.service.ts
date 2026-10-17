import { pool } from "../config/db.config.js";
import { ANSWER_MODEL, EMBEDDING_MODEL, OLLAMA_BASE_URL } from "../config/ollama.config.js";
import type { HealthReport, ServiceState } from "../types/health.type.js";

const OLLAMA_TIMEOUT_MS = 2000;

const isModelList = (value: unknown): value is { models: { name: string }[] } =>
    typeof value === "object" && value !== null
    && "models" in value && Array.isArray(value.models)
    && value.models.every((model: unknown) => typeof model === "object" && model !== null && "name" in model && typeof model.name === "string");

// Errors are caught on purpose in this file: a failing dependency is reported as "down", not thrown.
const checkDatabase = async (): Promise<ServiceState> => {
    try {
        await pool.query("SELECT 1");
        return "up";
    } catch {
        return "down";
    }
};

// Ollama counts as up only if it answers in time and both evaluated models are installed.
const checkOllama = async (): Promise<ServiceState> => {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS) });

        if (!response.ok) {
            return "down";
        }

        const body: unknown = await response.json();
        const installed = isModelList(body) ? body.models.map((model) => model.name) : [];

        return [ANSWER_MODEL, EMBEDDING_MODEL].every((model) => installed.includes(model)) ? "up" : "down";
    } catch {
        return "down";
    }
};

export const getHealthService = async (): Promise<HealthReport> => {
    const [database, ollama] = await Promise.all([checkDatabase(), checkOllama()]);

    let status: HealthReport["status"] = "ok";

    if (database === "down") {
        status = "down";
    } else if (ollama === "down") {
        status = "degraded";
    }

    return { status, database, ollama };
};
