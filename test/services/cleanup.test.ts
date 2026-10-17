import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/v1/config/db.config.js";
import { deleteExpiredDataService } from "../../src/v1/services/cleanup.service.js";
import { resetTestDatabase } from "../db/testDatabase.js";

const count = async (table: string): Promise<number> =>
    (await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("deleteExpiredDataService", () => {
    it("deletes documents older than 24 hours, with their chunks and jobs, and keeps newer ones", async () => {
        const { rows: [user] } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ('ana@example.com', 'x') RETURNING id");
        const { rows: [old] } = await pool.query<{ id: string }>(
            "INSERT INTO documents (user_id, filename, created_at) VALUES ($1, 'old.txt', now() - interval '25 hours') RETURNING id",
            [user.id]
        );
        await pool.query("INSERT INTO documents (user_id, filename, created_at) VALUES ($1, 'recent.txt', now() - interval '23 hours')", [user.id]);
        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'old text')", [old.id]);
        await pool.query("INSERT INTO jobs (user_id, document_id, type) VALUES ($1, $2, 'index_document')", [user.id, old.id]);

        const removed = await deleteExpiredDataService();

        assert.equal(removed.documents, 1);
        const { rows } = await pool.query("SELECT filename FROM documents");
        assert.deepEqual(rows.map((row) => row.filename), ["recent.txt"]);
        assert.equal(await count("chunks"), 0);
        assert.equal(await count("jobs"), 0);
    });

    it("deletes question records older than the daily quota window", async () => {
        const { rows: [user] } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ('ana@example.com', 'x') RETURNING id");
        await pool.query("INSERT INTO question_usage (user_id, asked_at) VALUES ($1, now() - interval '25 hours'), ($1, now() - interval '1 hour')", [user.id]);

        const removed = await deleteExpiredDataService();

        assert.equal(removed.questionUsage, 1);
        assert.equal(await count("question_usage"), 1);
    });

    it("deletes upload records older than the daily limit window", async () => {
        const { rows: [user] } = await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ('ana@example.com', 'x') RETURNING id");
        await pool.query("INSERT INTO upload_usage (user_id, uploaded_at) VALUES ($1, now() - interval '25 hours'), ($1, now() - interval '1 hour')", [user.id]);

        const removed = await deleteExpiredDataService();

        assert.equal(removed.uploadUsage, 1);
        assert.equal(await count("upload_usage"), 1);
    });

    it("does nothing when nothing has expired", async () => {
        assert.deepEqual(await deleteExpiredDataService(), { documents: 0, uploadUsage: 0, questionUsage: 0 });
    });
});
