import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// --- a fake Ollama that answers /api/embed, records every batch, and can misbehave on demand ---

type FakeMode = "ok" | "wrong-dimensions" | "drop-connection";
let mode: FakeMode = "ok";
let batches: string[][] = [];
// runs before the fake answers, to change the database in the middle of a job
let beforeAnswer: (() => Promise<void>) | null = null;

// a deterministic, non-zero vector per text
const vectorFor = (text: string, dimensions = 1024): number[] => {
    const seed = [...text].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
    return Array.from({ length: dimensions }, (_, index) => ((seed + index) % 97) / 97 + 0.01);
};

const fakeOllama = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
    }
    const input: string[] = JSON.parse(raw).input;
    batches.push(input);

    if (beforeAnswer) {
        await beforeAnswer();
    }
    if (mode === "drop-connection") {
        req.socket.destroy();
        return;
    }

    const dimensions = mode === "wrong-dimensions" ? 3 : 1024;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ embeddings: input.map((text) => vectorFor(text, dimensions)) }));
});

await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(fakeOllama.address() as AddressInfo).port}`;

const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createDocumentService } = await import("../../src/v1/services/documents.service.js");
const { getJobByIdService } = await import("../../src/v1/services/jobs.service.js");
const { embedTextsService } = await import("../../src/v1/services/ollama.service.js");
const {
    notifyJobQueuedService,
    processQueuedJobsService,
    recoverJobsService,
    requeueStuckJobsService,
    startJobWorkerService,
    stopJobWorkerService
} = await import("../../src/v1/services/jobQueue.service.js");
const { subscribeToEvents } = await import("../../src/v1/services/events.service.js");
const { AppError } = await import("../../src/v1/utils/appError.util.js");
const { ModelUnavailableError } = await import("../../src/v1/utils/modelUnavailableError.util.js");
type LiveEvent = import("../../src/v1/types/events.type.js").LiveEvent;

// 25 chunks of about 1,000 characters: three batches of 10, 10 and 5
const longText = (label: string) => Array.from({ length: 25 }, (_, index) => `${label} part ${index}. ${"word ".repeat(195)}`).join(" ");

const createUser = async (email: string): Promise<string> =>
    (await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [email])).rows[0].id;

const status = async (jobId: string) => {
    const { rows: [row] } = await pool.query<{ job: string; document: string; error: string | null; startedAt: Date | null }>(
        `SELECT j.status AS job, d.status AS document, j.error, j.started_at AS "startedAt"
         FROM jobs j JOIN documents d ON d.id = j.document_id WHERE j.id = $1`,
        [jobId]
    );
    return row;
};

let events: LiveEvent[] = [];

// waits until the events received so far pass the check (events sent in the background arrive a moment later)
const waitForEvents = async (check: (received: LiveEvent[]) => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 100 && !check(events); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(check(events), `events received: ${JSON.stringify(events)}`);
};
let unsubscribe: () => void = () => {};

before(resetTestDatabase);

beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    mode = "ok";
    batches = [];
    beforeAnswer = null;
    events = [];
    unsubscribe = subscribeToEvents((event) => events.push(event));
});

afterEach(() => {
    unsubscribe();
    stopJobWorkerService();
});

after(async () => {
    fakeOllama.close();
    await pool.end();
});

describe("processQueuedJobsService", () => {
    it("embeds every chunk in batches of 10, then marks the document ready and the job done", async () => {
        const userId = await createUser("ana@example.com");
        const { document, jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        await processQueuedJobsService();

        assert.deepEqual(batches.map((batch) => batch.length), [10, 10, 5]);
        assert.deepEqual(await status(jobId), { job: "done", document: "ready", error: null, startedAt: (await status(jobId)).startedAt });
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM chunks WHERE document_id = $1 AND embedding IS NULL", [document.id]);
        assert.equal(rows[0].count, 0);
        assert.deepEqual((await getJobByIdService(userId, jobId)).progress, { done: 25, total: 25 });
    });

    it("reports the place in line, started, progress after each batch, and done", async () => {
        const userId = await createUser("ana@example.com");
        const { document, jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });
        await waitForEvents((received) => received.length === 1);

        await processQueuedJobsService();

        assert.deepEqual(events, [
            { type: "queued", jobId, userId, position: 1 },
            { type: "started", jobId, userId },
            { type: "progress", jobId, userId, done: 10, total: 25 },
            { type: "progress", jobId, userId, done: 20, total: 25 },
            { type: "progress", jobId, userId, done: 25, total: 25 },
            { type: "done", jobId, userId, documentId: document.id }
        ]);
    });

    it("tells every waiting job its new place each time the line moves", async () => {
        const users = await Promise.all(["a@example.com", "b@example.com", "c@example.com"].map(createUser));
        const jobs: string[] = [];

        for (const userId of users) {
            jobs.push((await createDocumentService(userId, { filename: "short.txt", text: "A short text." })).jobId);
            await waitForEvents((received) => received.filter((event) => event.type === "queued").length === (jobs.length * (jobs.length + 1)) / 2);
        }

        await processQueuedJobsService();

        const positions = events.flatMap((event) => (event.type === "queued" ? [[jobs.indexOf(event.jobId), event.position]] : []));
        assert.deepEqual(positions, [
            // after each upload, every queued job hears its place
            [0, 1],
            [0, 1], [1, 2],
            [0, 1], [1, 2], [2, 3],
            // the worker takes the first job: the others move up
            [1, 1], [2, 2],
            // then the second
            [2, 1]
        ]);
        assert.ok(events.every((event) => event.userId === users[jobs.indexOf("jobId" in event ? event.jobId : "")]), "each event goes to the owner of its job");
    });

    it("continues where it stopped: chunks that already have a vector are not sent again", async () => {
        const userId = await createUser("ana@example.com");
        const { document } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });
        await pool.query(
            "UPDATE chunks SET embedding = $2::vector WHERE document_id = $1 AND chunk_index < 10",
            [document.id, JSON.stringify(vectorFor("already done"))]
        );

        await processQueuedJobsService();

        assert.deepEqual(batches.map((batch) => batch.length), [10, 5]);
        assert.deepEqual(events.filter((event) => event.type === "progress").map((event) => event.type === "progress" && event.done), [20, 25]);
    });

    it("fails the job and the document when Ollama answers with vectors of the wrong size", async (t) => {
        t.mock.method(console, "error", () => {});
        mode = "wrong-dimensions";
        const userId = await createUser("ana@example.com");
        const { jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        await processQueuedJobsService();

        const result = await status(jobId);
        assert.equal(result.job, "failed");
        assert.equal(result.document, "failed");
        assert.equal(result.error, "Indexing failed");
        assert.deepEqual(events.at(-1), { type: "failed", jobId, userId, error: "Indexing failed" });
    });

    it("puts the job back in the queue when Ollama cannot be reached, and finishes it later", async () => {
        mode = "drop-connection";
        const userId = await createUser("ana@example.com");
        const { jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        await processQueuedJobsService();

        assert.deepEqual(await status(jobId), { job: "queued", document: "pending", error: null, startedAt: null });
        assert.ok(!events.some((event) => event.type === "failed"));

        mode = "ok";
        await processQueuedJobsService();
        assert.equal((await status(jobId)).job, "done");
    });

    it("stops quietly when the document is deleted while it is being indexed", async () => {
        const userId = await createUser("ana@example.com");
        const { document } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });
        beforeAnswer = async () => {
            await pool.query("DELETE FROM documents WHERE id = $1", [document.id]);
        };

        await processQueuedJobsService();

        assert.equal(batches.length, 1);
        assert.ok(!events.some((event) => event.type === "done" || event.type === "failed"));
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM jobs");
        assert.equal(rows[0].count, 0);
    });

    it("runs one job at a time, oldest first, even when started twice at once", async () => {
        const first = await createDocumentService(await createUser("ana@example.com"), { filename: "a.txt", text: longText("first") });
        const second = await createDocumentService(await createUser("bob@example.com"), { filename: "b.txt", text: longText("second") });

        await Promise.all([processQueuedJobsService(), processQueuedJobsService()]);

        const sent = batches.flat();
        const { rows: firstChunks } = await pool.query<{ text: string }>(
            "SELECT text FROM chunks WHERE document_id = $1 ORDER BY chunk_index",
            [first.document.id]
        );
        assert.equal(sent.length, 50, "every chunk is embedded exactly once");
        assert.equal(new Set(sent).size, 50);
        assert.deepEqual(sent.slice(0, 25), firstChunks.map((chunk) => chunk.text), "the older job runs first, in chunk order");
        assert.equal((await status(first.jobId)).job, "done");
        assert.equal((await status(second.jobId)).job, "done");
    });

    it("keeps going when an event listener throws", async (t) => {
        t.mock.method(console, "error", () => {});
        const unsubscribeBroken = subscribeToEvents(() => {
            throw new Error("broken listener");
        });
        const userId = await createUser("ana@example.com");
        const { jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        try {
            await processQueuedJobsService();
        } finally {
            unsubscribeBroken();
        }

        assert.equal((await status(jobId)).job, "done");
    });
});

describe("the worker", () => {
    it("does not start indexing on its own: uploads wait until server.ts starts the worker", async () => {
        const userId = await createUser("ana@example.com");
        const { jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        notifyJobQueuedService();
        await new Promise((resolve) => setTimeout(resolve, 200));

        assert.equal((await status(jobId)).job, "queued");
        assert.equal(batches.length, 0);
    });

    it("indexes uploads by itself once started", async () => {
        startJobWorkerService();
        const userId = await createUser("ana@example.com");
        const { jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });

        for (let attempt = 0; attempt < 50 && (await status(jobId)).job !== "done"; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        assert.equal((await status(jobId)).job, "done");
    });
});

describe("recoverJobsService", () => {
    it("puts jobs interrupted by a shutdown back in the queue, keeping their stored vectors", async () => {
        const userId = await createUser("ana@example.com");
        const { document, jobId } = await createDocumentService(userId, { filename: "long.txt", text: longText("ana") });
        await pool.query("UPDATE jobs SET status = 'processing', started_at = now() WHERE id = $1", [jobId]);
        await pool.query("UPDATE documents SET status = 'indexing' WHERE id = $1", [document.id]);
        await pool.query("UPDATE chunks SET embedding = $2::vector WHERE document_id = $1 AND chunk_index = 0", [document.id, JSON.stringify(vectorFor("kept"))]);

        assert.equal(await recoverJobsService(), 1);

        assert.deepEqual(await status(jobId), { job: "queued", document: "pending", error: null, startedAt: null });
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM chunks WHERE document_id = $1 AND embedding IS NOT NULL", [document.id]);
        assert.equal(rows[0].count, 1);
    });
});

describe("requeueStuckJobsService", () => {
    it("puts back jobs stuck in processing for over a minute, keeping their vectors, and leaves recent ones alone", async () => {
        const stuck = await createDocumentService(await createUser("ana@example.com"), { filename: "stuck.txt", text: longText("ana") });
        const recent = await createDocumentService(await createUser("bob@example.com"), { filename: "recent.txt", text: longText("bob") });
        await pool.query("UPDATE jobs SET status = 'processing', started_at = now() - interval '2 minutes' WHERE id = $1", [stuck.jobId]);
        await pool.query("UPDATE documents SET status = 'indexing' WHERE id = $1", [stuck.document.id]);
        await pool.query("UPDATE chunks SET embedding = $2::vector WHERE document_id = $1 AND chunk_index = 0", [stuck.document.id, JSON.stringify(vectorFor("kept"))]);
        // just claimed by the worker: it may not have started yet, so it is not stuck
        await pool.query("UPDATE jobs SET status = 'processing', started_at = now() WHERE id = $1", [recent.jobId]);

        assert.equal(await requeueStuckJobsService(), 1);

        assert.deepEqual(await status(stuck.jobId), { job: "queued", document: "pending", error: null, startedAt: null });
        assert.equal((await status(recent.jobId)).job, "processing");
        const { rows } = await pool.query("SELECT count(*)::int AS count FROM chunks WHERE document_id = $1 AND embedding IS NOT NULL", [stuck.document.id]);
        assert.equal(rows[0].count, 1);
    });
});

describe("embedTextsService", () => {
    it("returns one vector per text, in order", async () => {
        const vectors = await embedTextsService(["a", "b"]);

        assert.deepEqual(vectors, [vectorFor("a"), vectorFor("b")]);
    });

    it("throws a ModelUnavailableError, a 503 AppError, when Ollama cannot be reached", async () => {
        mode = "drop-connection";

        await assert.rejects(embedTextsService(["a"]), (error: unknown) =>
            error instanceof ModelUnavailableError
            && error instanceof AppError
            && error.status === 503
            && error.message === "The model server is not available");
    });

    it("throws a plain error when the vectors have the wrong size", async () => {
        mode = "wrong-dimensions";

        await assert.rejects(embedTextsService(["a"]), (error: unknown) => !(error instanceof AppError) && /1024/.test((error as Error).message));
    });
});
