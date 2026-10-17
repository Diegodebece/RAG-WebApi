import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.MAX_QUEUED_JOBS = "20";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");

type Auth = [string, string];

const upload = async (auth: Auth): Promise<{ documentId: string; jobId: string }> => {
    const response = await request(app).post("/v1/documents").set(...auth).send({ filename: "notes.txt", text: "Some text to index." });
    return { documentId: response.body.data.document.id, jobId: response.body.data.jobId };
};

const getJob = (auth: Auth, id: string) => request(app).get(`/v1/jobs/${id}`).set(...auth);

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("GET /v1/jobs/:id", () => {
    it("returns the caller's job with its queue position", async () => {
        const ana = await createTestUser("ana@example.com");
        const { documentId, jobId } = await upload(ana.auth);

        const response = await getJob(ana.auth, jobId);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.id, jobId);
        assert.equal(response.body.data.documentId, documentId);
        assert.equal(response.body.data.type, "index_document");
        assert.equal(response.body.data.status, "queued");
        assert.equal(response.body.data.queuePosition, 1);
        assert.equal(response.body.data.error, null);
        assert.deepEqual(response.body.data.progress, { done: 0, total: 1 });
    });

    it("counts the queued jobs of other users ahead in the position", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const first = await upload(ana.auth);
        const second = await upload(bob.auth);

        assert.equal((await getJob(bob.auth, second.jobId)).body.data.queuePosition, 2);

        // once Ana's job starts running, Bob's is next in line and Ana's has no position
        await pool.query("UPDATE jobs SET status = 'processing', started_at = now() WHERE id = $1", [first.jobId]);
        assert.equal((await getJob(bob.auth, second.jobId)).body.data.queuePosition, 1);
        assert.equal((await getJob(ana.auth, first.jobId)).body.data.queuePosition, null);
    });

    it("answers another user's job, an unknown id and a malformed id with the same 404", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const { jobId } = await upload(ana.auth);

        for (const id of [jobId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
            const response = await getJob(bob.auth, id);
            assert.equal(response.status, 404, id);
            assert.deepEqual(response.body, { message: "Job not found" }, id);
        }
    });

    it("requires a token", async () => {
        assert.equal((await request(app).get("/v1/jobs/00000000-0000-4000-8000-000000000000")).status, 401);
    });
});
