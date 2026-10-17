export type ServiceState = "up" | "down";

// ok: everything works; degraded: the API answers but Ollama does not (no indexing or answers);
// down: the database does not answer, so nothing works
export interface HealthReport {
    status: "ok" | "degraded" | "down";
    database: ServiceState;
    ollama: ServiceState;
}
