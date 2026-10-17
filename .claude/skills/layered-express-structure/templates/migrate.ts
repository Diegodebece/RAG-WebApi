import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pool, withTransaction } from "./v1/config/db.config.js";

// migrations/ sits next to src/ and dist/, so this path works both with tsx and from the compiled file
const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "migrations");

// Any number works; it only has to be the same for every process that runs migrations.
const MIGRATIONS_LOCK_ID = 72617001;

const applyPendingMigrations = async (): Promise<void> => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version text PRIMARY KEY,
            applied_at timestamptz NOT NULL DEFAULT now()
        )
    `);

    const { rows } = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.version));
    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
    const pending = files.filter((file) => !applied.has(file));

    if (pending.length === 0) {
        console.log("Database is up to date");
        return;
    }

    for (const file of pending) {
        const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");

        try {
            // the file and its record are applied together, or not at all
            await withTransaction(async (client) => {
                await client.query(sql);
                await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
            });
        } catch (error) {
            throw new Error(`Migration ${file} failed`, { cause: error });
        }

        console.log(`Applied ${file}`);
    }
};

// A session-level advisory lock: a second process that runs migrations at the same time waits here.
const migrate = async (): Promise<void> => {
    const lockClient = await pool.connect();

    try {
        await lockClient.query("SELECT pg_advisory_lock($1)", [MIGRATIONS_LOCK_ID]);

        try {
            await applyPendingMigrations();
        } finally {
            await lockClient.query("SELECT pg_advisory_unlock($1)", [MIGRATIONS_LOCK_ID]);
        }
    } finally {
        lockClient.release();
    }
};

try {
    await migrate();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
