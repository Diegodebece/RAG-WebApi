import pg from "pg";
import type { PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL;

// fail at startup instead of on the first request
if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
}

// One pool for the whole process: it keeps a few connections open and lends one to each query.
// Without a connection timeout, a query waits forever when PostgreSQL is down instead of failing.
export const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });

// An idle connection can break (for example when PostgreSQL restarts). Without a listener,
// that "error" event would crash the process; the pool replaces the connection on its own.
pool.on("error", (error) => {
    console.error("Unexpected error on an idle PostgreSQL connection", error);
});

// Keys of the PostgreSQL advisory locks the API takes, one per shared resource, so two locks never collide.
export const LOCK_KEYS = {
    // the indexing queue's length, checked by every upload
    indexingQueue: 72_120_261
} as const;

// Runs every query of the callback on one connection, inside one transaction:
// COMMIT when the callback resolves, ROLLBACK when it throws (and the error is rethrown).
export const withTransaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    // A connection lent by the pool has no "error" listener of its own: if it broke during the transaction
    // (PostgreSQL restarting, for example), the unhandled event would crash the process. The query that was
    // running fails anyway, and that failure is what the caller gets.
    let broken = false;
    const onError = (error: Error): void => {
        broken = true;
        console.error("A PostgreSQL connection broke during a transaction", error);
    };
    client.on("error", onError);

    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            // the original error says what went wrong; a failed ROLLBACK must not replace it
            broken = true;
            console.error("Could not roll back a transaction", rollbackError);
        }
        throw error;
    } finally {
        client.off("error", onError);
        // a broken connection is closed instead of going back to the pool
        client.release(broken);
    }
};
