import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool, withTransaction } from "../../src/v1/config/db.config.js";
import { resetTestDatabase } from "./testDatabase.js";

// pgvector reads '[0.1,0.2,...]', which is exactly what JSON.stringify produces for a number array
const toVector = (values: number[]): string => JSON.stringify(values);

const vectorOf = (value: number, dimensions = 1024): string => toVector(new Array(dimensions).fill(value));

const createUser = async (email = "ana@example.com"): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (email, password_hash) VALUES ($1, 'hash') RETURNING id",
        [email]
    );
    return rows[0].id;
};

const createDocument = async (userId: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO documents (user_id, filename) VALUES ($1, 'notes.txt') RETURNING id",
        [userId]
    );
    return rows[0].id;
};

const countRows = async (table: string): Promise<number> => {
    // table names cannot be query parameters; these come from the tests, never from users
    const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM ${table}`);
    return Number(rows[0].count);
};

// closes the pool once, after both suites in this file
after(() => pool.end());

describe("database schema", () => {
    before(resetTestDatabase);

    // every table references users, so this empties them all
    beforeEach(() => pool.query("TRUNCATE users CASCADE"));

    it("generates a UUID id and defaults for a new user", async () => {
        const { rows } = await pool.query<{ id: string; role: string }>(
            "INSERT INTO users (email, password_hash) VALUES ('ana@example.com', 'hash') RETURNING id, role"
        );

        assert.match(rows[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.equal(rows[0].role, "user");
    });

    it("rejects the same email with different capitalization", async () => {
        await createUser("ana@example.com");

        await assert.rejects(createUser("Ana@Example.COM"), { code: "23505" });
    });

    it("rejects values outside the allowed lists", async () => {
        const userId = await createUser();

        await assert.rejects(
            pool.query("UPDATE users SET role = 'superadmin' WHERE id = $1", [userId]),
            { code: "23514" }
        );
        await assert.rejects(
            pool.query("INSERT INTO documents (user_id, filename, status) VALUES ($1, 'a.txt', 'done')", [userId]),
            { code: "23514" }
        );
    });

    it("rejects a document for a user that does not exist", async () => {
        await assert.rejects(createDocument("00000000-0000-4000-8000-000000000000"), { code: "23503" });
    });

    it("stores a chunk without an embedding, then accepts a 1024-dimension vector", async () => {
        const documentId = await createDocument(await createUser());

        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'Hello')", [documentId]);
        await pool.query("UPDATE chunks SET embedding = $2 WHERE document_id = $1 AND chunk_index = 0", [
            documentId,
            vectorOf(0.1)
        ]);

        const { rows } = await pool.query("SELECT 1 FROM chunks WHERE document_id = $1 AND embedding IS NOT NULL", [documentId]);
        assert.equal(rows.length, 1);
    });

    it("rejects a vector with the wrong number of dimensions", async () => {
        const documentId = await createDocument(await createUser());

        await assert.rejects(
            pool.query("INSERT INTO chunks (document_id, chunk_index, text, embedding) VALUES ($1, 0, 'Hi', $2)", [
                documentId,
                toVector([0.1, 0.2, 0.3])
            ]),
            /expected 1024 dimensions/
        );
    });

    it("rejects two chunks at the same position of a document", async () => {
        const documentId = await createDocument(await createUser());

        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'a')", [documentId]);
        await assert.rejects(
            pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'b')", [documentId]),
            { code: "23505" }
        );
    });

    it("computes cosine similarity as 1 - (a <=> b), like RAG1", async () => {
        const documentId = await createDocument(await createUser());
        const opposite = new Array(1024).fill(0.1).map((value, index) => (index === 0 ? -value : value));

        await pool.query(
            "INSERT INTO chunks (document_id, chunk_index, text, embedding) VALUES ($1, 0, 'same', $2), ($1, 1, 'close', $3)",
            [documentId, vectorOf(0.1), toVector(opposite)]
        );

        const { rows } = await pool.query<{ chunkIndex: number; score: number }>(
            `SELECT chunk_index AS "chunkIndex", 1 - (embedding <=> $2) AS score
             FROM chunks WHERE document_id = $1 ORDER BY embedding <=> $2`,
            [documentId, vectorOf(0.1)]
        );

        assert.equal(rows[0].chunkIndex, 0);
        assert.ok(Math.abs(rows[0].score - 1) < 1e-6);
        assert.equal(rows[1].chunkIndex, 1);
        assert.ok(rows[1].score < rows[0].score);
    });

    it("deleting a user deletes everything they own", async () => {
        const userId = await createUser();
        const documentId = await createDocument(userId);
        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'a')", [documentId]);
        await pool.query("INSERT INTO jobs (user_id, document_id, type) VALUES ($1, $2, 'index_document')", [userId, documentId]);
        await pool.query("INSERT INTO question_usage (user_id) VALUES ($1)", [userId]);
        await pool.query("INSERT INTO upload_usage (user_id) VALUES ($1)", [userId]);

        await pool.query("DELETE FROM users WHERE id = $1", [userId]);

        for (const table of ["documents", "chunks", "jobs", "question_usage", "upload_usage"]) {
            assert.equal(await countRows(table), 0, table);
        }
    });

    it("deleting a document deletes its chunks and jobs but keeps the question and upload counts", async () => {
        const userId = await createUser();
        const documentId = await createDocument(userId);
        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'a')", [documentId]);
        await pool.query("INSERT INTO jobs (user_id, document_id, type) VALUES ($1, $2, 'answer_question')", [userId, documentId]);
        await pool.query("INSERT INTO question_usage (user_id) VALUES ($1), ($1)", [userId]);
        await pool.query("INSERT INTO upload_usage (user_id) VALUES ($1)", [userId]);

        await pool.query("DELETE FROM documents WHERE id = $1", [documentId]);

        assert.equal(await countRows("chunks"), 0);
        assert.equal(await countRows("jobs"), 0);
        assert.equal(await countRows("question_usage"), 2);
        assert.equal(await countRows("upload_usage"), 1);
    });
});

describe("withTransaction", () => {
    before(resetTestDatabase);

    beforeEach(() => pool.query("TRUNCATE users CASCADE"));

    it("commits every query when the callback succeeds", async () => {
        await withTransaction(async (client) => {
            await client.query("INSERT INTO users (email, password_hash) VALUES ('a@example.com', 'hash')");
            await client.query("INSERT INTO users (email, password_hash) VALUES ('b@example.com', 'hash')");
        });

        assert.equal(await countRows("users"), 2);
    });

    it("rolls back every query and rethrows when the callback fails", async () => {
        await assert.rejects(
            withTransaction(async (client) => {
                await client.query("INSERT INTO users (email, password_hash) VALUES ('a@example.com', 'hash')");
                await client.query("INSERT INTO users (email, password_hash) VALUES ('A@example.com', 'hash')");
            }),
            { code: "23505" }
        );

        assert.equal(await countRows("users"), 0);
    });
});
