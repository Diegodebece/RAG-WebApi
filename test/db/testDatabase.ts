import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../../src/v1/config/db.config.js";

const execFileAsync = promisify(execFile);

// Second line of defense next to test/setup.ts: never wipe a database whose name does not end in _test.
const assertTestDatabase = async (): Promise<void> => {
    const { rows } = await pool.query<{ name: string }>("SELECT current_database() AS name");

    if (!rows[0].name.endsWith("_test")) {
        throw new Error(`Refusing to reset "${rows[0].name}": test databases must end in _test`);
    }
};

// Runs the real migration script, as `npm run migrate` would, against the test database.
export const runMigrateScript = async (): Promise<string> => {
    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "src/migrate.ts"], {
        env: { ...process.env }
    });

    return stdout;
};

// Drops every table (and the vector extension, which lives in the same schema) so each test file starts empty.
export const emptyTestDatabase = async (): Promise<void> => {
    await assertTestDatabase();
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
};

// Empty schema, then all migrations applied.
export const resetTestDatabase = async (): Promise<void> => {
    await emptyTestDatabase();
    await runMigrateScript();
};
