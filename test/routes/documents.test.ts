import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.MAX_DOCUMENTS_PER_USER = "3";
process.env.MAX_UPLOADS_PER_DAY = "3";
process.env.MAX_DOCUMENT_CHARS = "200000";
process.env.MAX_QUEUED_JOBS = "3";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");
const { chunkText } = await import("../../src/v1/utils/chunkText.util.js");

type Auth = [string, string];

const sampleText = Array.from({ length: 300 }, (_, index) => `Sentence number ${index} about the document.`).join(" ");

const upload = (auth: Auth, body: object = { filename: "notes.txt", text: sampleText }) =>
    request(app).post("/v1/documents").set(...auth).send(body);

// lets the next upload of the same user through the "one indexing job at a time" rule
const finishJobs = () => pool.query("UPDATE jobs SET status = 'done', finished_at = now()");

const HOUR_MS = 60 * 60 * 1000;

const countUploads = async (): Promise<number> =>
    (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM upload_usage")).rows[0].count;

// upload, let the indexing finish and delete the document, so neither the document limit nor the
// "one indexing job at a time" rule stops the next upload
const uploadAndDelete = async (auth: Auth) => {
    const response = await upload(auth);
    await finishJobs();

    if (response.status === 202) {
        await request(app).delete(`/v1/documents/${response.body.data.document.id}`).set(...auth);
    }

    return response;
};

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("POST /v1/documents", () => {
    it("stores the text as chunks without embeddings and queues an indexing job", async () => {
        const ana = await createTestUser("ana@example.com");

        const response = await upload(ana.auth);

        assert.equal(response.status, 202);
        const { document, jobId } = response.body.data;
        const expectedChunks = chunkText(sampleText);
        assert.equal(document.filename, "notes.txt");
        assert.equal(document.status, "pending");
        assert.equal(document.chunkCount, expectedChunks.length);
        assert.equal(new Date(document.expiresAt).getTime() - new Date(document.createdAt).getTime(), 24 * HOUR_MS);

        const { rows: chunks } = await pool.query<{ chunk_index: number; text: string; embedding: string | null }>(
            "SELECT chunk_index, text, embedding FROM chunks WHERE document_id = $1 ORDER BY chunk_index",
            [document.id]
        );
        assert.deepEqual(chunks.map((chunk) => chunk.text), expectedChunks);
        assert.deepEqual(chunks.map((chunk) => chunk.chunk_index), expectedChunks.map((_, index) => index));
        assert.ok(chunks.every((chunk) => chunk.embedding === null));

        const { rows: [job] } = await pool.query("SELECT id, user_id, document_id, type, status FROM jobs");
        assert.deepEqual(job, { id: jobId, user_id: ana.id, document_id: document.id, type: "index_document", status: "queued" });
    });

    it("cleans the text before chunking it", async () => {
        const ana = await createTestUser("ana@example.com");
        const dirty = `  First line.\r\nSecond${String.fromCharCode(0)} line.${String.fromCharCode(7)}  `;

        const response = await upload(ana.auth, { filename: "dirty.txt", text: dirty });

        const { rows } = await pool.query("SELECT text FROM chunks WHERE document_id = $1", [response.body.data.document.id]);
        assert.deepEqual(rows.map((row) => row.text), ["First line. Second line."]);
    });

    it("rejects a text with nothing readable in it", async () => {
        const ana = await createTestUser("ana@example.com");

        const response = await upload(ana.auth, { filename: "empty.txt", text: `   \n\t ${String.fromCharCode(1)} ` });

        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { message: "The document has no readable text" });
    });

    it("validates the filename and the text length", async () => {
        const ana = await createTestUser("ana@example.com");
        const cases = {
            "missing filename": { text: sampleText },
            "long filename": { filename: "x".repeat(256), text: sampleText },
            "missing text": { filename: "a.txt" },
            "text over the limit": { filename: "a.txt", text: "x".repeat(200001) }
        };

        for (const [label, body] of Object.entries(cases)) {
            const response = await upload(ana.auth, body);
            assert.equal(response.status, 400, label);
        }
    });

    it("rejects filenames with control or text-direction characters", async () => {
        const ana = await createTestUser("ana@example.com");
        const names = {
            "null byte": `notes${String.fromCodePoint(0)}.txt`,
            "new line": `notes${String.fromCodePoint(0x0a)}.txt`,
            "right-to-left override": `invoice${String.fromCodePoint(0x202e)}txt.exe`,
            "right-to-left isolate": `invoice${String.fromCodePoint(0x2067)}txt.exe`
        };

        for (const [label, filename] of Object.entries(names)) {
            const response = await upload(ana.auth, { filename, text: sampleText });
            assert.equal(response.status, 400, label);
            assert.deepEqual(response.body, { message: "Validation error", details: ["Filename contains control or text-direction characters"] }, label);
        }

        const accepted = await upload(ana.auth, { filename: `Informe a${String.fromCodePoint(0xf1)}o ${String.fromCodePoint(0x05e9, 0x05dc, 0x05d5, 0x05dd)}.txt`, text: sampleText });
        assert.equal(accepted.status, 202);
    });

    it("accepts a document larger than the 100 KB default body limit, up to 2 MB", async () => {
        const ana = await createTestUser("ana@example.com");

        const accepted = await upload(ana.auth, { filename: "long.txt", text: "palabra ".repeat(19000) });
        const tooLarge = await upload(ana.auth, { filename: "huge.txt", text: "x".repeat(2_200_000) });

        assert.equal(accepted.status, 202);
        assert.equal(tooLarge.status, 413);
    });

    it("rejects anonymous uploads before reading their body", async () => {
        // Over the 2 MB limit on purpose: reading the body first would answer 413. The server answers 401
        // without reading it, and may close the connection while the client is still sending (ECONNRESET).
        let outcome: string;

        try {
            outcome = String((await request(app).post("/v1/documents").send({ filename: "big.txt", text: "x".repeat(2_500_000) })).status);
        } catch (error) {
            outcome = error instanceof Error ? error.message : String(error);
        }

        assert.ok(outcome === "401" || /ECONNRESET|EPIPE|socket hang up/i.test(outcome), outcome);
    });

    it("allows 3 documents per user", async () => {
        const ana = await createTestUser("ana@example.com");

        for (let index = 0; index < 3; index++) {
            assert.equal((await upload(ana.auth)).status, 202);
            await finishJobs();
        }

        const fourth = await upload(ana.auth);
        assert.equal(fourth.status, 409);
        assert.match(fourth.body.message, /Document limit reached/);
    });

    it("allows 3 uploads per user per day, even when the documents are deleted", async () => {
        const ana = await createTestUser("ana@example.com");

        for (let index = 0; index < 3; index++) {
            assert.equal((await uploadAndDelete(ana.auth)).status, 202);
        }

        const fourth = await upload(ana.auth);
        assert.equal(fourth.status, 429);
        assert.deepEqual(fourth.body, { message: "Daily upload limit reached (3): try again tomorrow" });

        const bob = await createTestUser("bob@example.com");
        assert.equal((await upload(bob.auth)).status, 202, "the limit is per user");
    });

    it("counts only accepted uploads toward the daily limit", async () => {
        const ana = await createTestUser("ana@example.com");
        await upload(ana.auth);

        assert.equal((await upload(ana.auth)).status, 409);
        assert.equal((await upload(ana.auth, { filename: "a.txt" })).status, 400);

        assert.equal(await countUploads(), 1);
    });

    it("does not count uploads older than 24 hours toward the daily limit", async () => {
        const ana = await createTestUser("ana@example.com");
        await pool.query("INSERT INTO upload_usage (user_id, uploaded_at) SELECT $1, now() - interval '25 hours' FROM generate_series(1, 3)", [ana.id]);

        assert.equal((await upload(ana.auth)).status, 202);
    });

    it("allows one document being indexed at a time per user", async () => {
        const ana = await createTestUser("ana@example.com");
        await upload(ana.auth);

        const second = await upload(ana.auth);

        assert.equal(second.status, 409);
        assert.match(second.body.message, /still being indexed/);
    });

    it("lets only one of two simultaneous uploads from the same user through", async () => {
        const ana = await createTestUser("ana@example.com");

        const responses = await Promise.all([upload(ana.auth), upload(ana.auth)]);

        assert.deepEqual(responses.map((response) => response.status).sort(), [202, 409]);
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM documents");
        assert.equal(rows[0].count, 1);
    });

    it("serializes the uploads of one user by locking the user's row", async () => {
        // The test above passes even without the lock when the two requests do not overlap at the right
        // moment. Holding a lock on the row by hand shows deterministically that an upload waits for it.
        // FOR NO KEY UPDATE conflicts with the service's FOR UPDATE but not with the light lock PostgreSQL
        // takes when it checks the documents.user_id foreign key, so only the service's own lock makes it wait.
        const ana = await createTestUser("ana@example.com");
        const client = await pool.connect();
        let finished = false;

        try {
            await client.query("BEGIN");
            await client.query("SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE", [ana.id]);

            const pending = (async () => {
                const response = await upload(ana.auth);
                finished = true;
                return response;
            })();

            await new Promise((resolve) => setTimeout(resolve, 300));
            assert.equal(finished, false, "the upload must wait while another transaction holds the user's row");

            await client.query("COMMIT");
            assert.equal((await pending).status, 202);
        } finally {
            client.release();
        }
    });

    it("answers 503 when the job queue is full", async () => {
        for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
            assert.equal((await upload((await createTestUser(email)).auth)).status, 202);
        }

        const response = await upload((await createTestUser("d@example.com")).auth);

        assert.equal(response.status, 503);
        assert.match(response.body.message, /busy/);
    });

    it("answers 404 when the token's account no longer exists", async () => {
        const ana = await createTestUser("ana@example.com");
        await pool.query("DELETE FROM users");

        const response = await upload(ana.auth);

        assert.equal(response.status, 404);
        assert.deepEqual(response.body, { message: "User not found" });
    });
});

describe("reading and deleting documents", () => {
    it("lists only the caller's documents, newest first", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        await upload(ana.auth, { filename: "first.txt", text: sampleText });
        await finishJobs();
        await upload(ana.auth, { filename: "second.txt", text: sampleText });
        await upload(bob.auth, { filename: "bob.txt", text: sampleText });

        const response = await request(app).get("/v1/documents").set(...ana.auth);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data.map((document: { filename: string }) => document.filename), ["second.txt", "first.txt"]);
    });

    it("returns an empty list, not a 404, when there are no documents", async () => {
        const ana = await createTestUser("ana@example.com");

        const response = await request(app).get("/v1/documents").set(...ana.auth);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, []);
    });

    it("returns one of the caller's documents", async () => {
        const ana = await createTestUser("ana@example.com");
        const { body } = await upload(ana.auth);

        const response = await request(app).get(`/v1/documents/${body.data.document.id}`).set(...ana.auth);

        assert.equal(response.status, 200);
        assert.deepEqual(response.body.data, body.data.document);
    });

    it("answers another user's document, an unknown id and a malformed id with the same 404", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const { body } = await upload(ana.auth);

        for (const id of [body.data.document.id, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
            const response = await request(app).get(`/v1/documents/${id}`).set(...bob.auth);
            assert.equal(response.status, 404, id);
            assert.deepEqual(response.body, { message: "Document not found" }, id);
        }
    });

    it("deletes the caller's document with its chunks and jobs", async () => {
        const ana = await createTestUser("ana@example.com");
        const { body } = await upload(ana.auth);

        const response = await request(app).delete(`/v1/documents/${body.data.document.id}`).set(...ana.auth);

        assert.equal(response.status, 200);
        for (const table of ["documents", "chunks", "jobs"]) {
            const { rows } = await pool.query(`SELECT count(*)::int AS count FROM ${table}`);
            assert.equal(rows[0].count, 0, table);
        }
    });

    it("does not let another user delete a document", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const { body } = await upload(ana.auth);

        const response = await request(app).delete(`/v1/documents/${body.data.document.id}`).set(...bob.auth);

        assert.equal(response.status, 404);
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM documents");
        assert.equal(rows[0].count, 1);
    });

    it("answers a malformed id on delete with a 404", async () => {
        const ana = await createTestUser("ana@example.com");

        const response = await request(app).delete("/v1/documents/not-a-uuid").set(...ana.auth);

        assert.equal(response.status, 404);
    });

    it("requires a token for every documents route", async () => {
        for (const [method, path] of [["get", "/v1/documents"], ["get", "/v1/documents/x"], ["delete", "/v1/documents/x"]] as const) {
            assert.equal((await request(app)[method](path)).status, 401, `${method} ${path}`);
        }
    });

    it("reports document and upload usage in GET /v1/users/me", async () => {
        const ana = await createTestUser("ana@example.com");
        await uploadAndDelete(ana.auth);
        await upload(ana.auth);

        const response = await request(app).get("/v1/users/me").set(...ana.auth);

        assert.deepEqual(response.body.data.usage, { documents: { used: 1, limit: 3 }, uploadsToday: { used: 2, limit: 3 } });
    });
});
