import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/v1/config/db.config.js";
import { emptyTestDatabase, runMigrateScript } from "./testDatabase.js";

describe("migrate script", () => {
    before(emptyTestDatabase);

    after(() => pool.end());

    it("applies every migration to an empty database", async () => {
        const output = await runMigrateScript();

        assert.match(output, /Applied 001_init\.sql/);
        assert.match(output, /Applied 002_upload_usage\.sql/);

        const { rows } = await pool.query<{ table_name: string }>(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
        );
        assert.deepEqual(rows.map((row) => row.table_name), [
            "chunks",
            "documents",
            "jobs",
            "question_usage",
            "schema_migrations",
            "upload_usage",
            "users"
        ]);
    });

    it("enables pgvector", async () => {
        const { rows } = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");

        assert.equal(rows.length, 1);
    });

    it("records applied migrations and skips them on the next run", async () => {
        const output = await runMigrateScript();

        assert.match(output, /Database is up to date/);

        const { rows } = await pool.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
        assert.deepEqual(rows.map((row) => row.version), ["001_init.sql", "002_upload_usage.sql"]);
    });
});
