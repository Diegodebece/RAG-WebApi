import pg from "pg";
import type { PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;

// fail at startup instead of on the first request
if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
}

// One pool for the whole process: it keeps a few connections open and lends one to each query.
export const pool = new pg.Pool({ connectionString });

// An idle connection can break (for example when PostgreSQL restarts). Without a listener,
// that "error" event would crash the process; the pool replaces the connection on its own.
pool.on("error", (error) => {
    console.error("Unexpected error on an idle PostgreSQL connection", error);
});

// Runs every query of the callback on one connection, inside one transaction:
// COMMIT when the callback resolves, ROLLBACK when it throws (and the error is rethrown).
export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};
