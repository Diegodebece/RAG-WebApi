import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import jwt from "jsonwebtoken";
import request from "supertest";

// --- a fake Ollama: every text embeds to the same vector, and the chat answers after chatDelayMs ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const VECTOR = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));
let chatDelayMs = 0;

const fakeOllama = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
    }
    const body = JSON.parse(raw);

    if (req.url === "/api/embed") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ embeddings: body.input.map(() => VECTOR) }));
        return;
    }

    await sleep(chatDelayMs);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { role: "assistant", content: "Answer [F1]." }, done: true }));
});

await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(fakeOllama.address() as AddressInfo).port}`;
const SECRET = "test-secret-only-for-these-tests-0123456789";
process.env.SECRET_KEY = SECRET;
process.env.MAX_EVENT_STREAMS_PER_USER = "2";
process.env.MAX_EVENT_STREAMS = "3";
process.env.EVENT_STREAM_HEARTBEAT_SECONDS = "1";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");
const { emitEvent } = await import("../../src/v1/services/events.service.js");
const { processQueuedJobsService } = await import("../../src/v1/services/jobQueue.service.js");

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const port = (server.address() as AddressInfo).port;

// --- a client that reads the stream as it arrives ---

interface Stream {
    status: number;
    headers: IncomingHttpHeaders;
    // complete messages received so far: comments (": ...") and events ("event: ...\ndata: ...")
    frames: string[];
    body: () => string;
    close: () => void;
    ended: Promise<void>;
}

const openStreams: Stream[] = [];

const openStream = (token: string): Promise<Stream> => new Promise((resolve) => {
    const req = get({ host: "127.0.0.1", port, path: "/v1/events", headers: { Authorization: `Bearer ${token}` } }, (res) => {
        const frames: string[] = [];
        let raw = "";
        let buffer = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
            raw += chunk;
            buffer += chunk;
            for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
                frames.push(buffer.slice(0, end));
                buffer = buffer.slice(end + 2);
            }
        });
        const ended = new Promise<void>((done) => res.on("close", () => done()));
        const stream = { status: res.statusCode ?? 0, headers: res.headers, frames, body: () => raw, close: () => req.destroy(), ended };
        openStreams.push(stream);
        resolve(stream);
    });
    // closing a stream on purpose destroys the request
    req.on("error", () => {});
});

const eventsIn = (stream: Stream) => stream.frames
    .filter((frame) => frame.startsWith("event: "))
    .map((frame) => {
        const [eventLine, dataLine] = frame.split("\n");
        return { type: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) };
    });

const waitFor = async (check: () => boolean, label: string, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!check() && Date.now() < deadline) {
        await sleep(10);
    }
    assert.ok(check(), label);
};

// waits for a refused stream to end; a stream that was wrongly accepted stays open, so give up after a second
const endOf = (stream: Stream) => Promise.race([stream.ended, sleep(1000)]);

// a ready document whose only chunk matches every question
const createReadyDocument = async (userId: string): Promise<string> => {
    const { rows: [document] } = await pool.query<{ id: string }>(
        "INSERT INTO documents (user_id, filename, status, chunk_count) VALUES ($1, 'notes.txt', 'ready', 1) RETURNING id",
        [userId]
    );
    await pool.query("INSERT INTO chunks (document_id, chunk_index, text, embedding) VALUES ($1, 0, 'Chunk 0', $2::vector)", [document.id, JSON.stringify(VECTOR)]);
    return document.id;
};

before(resetTestDatabase);

beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    chatDelayMs = 0;
});

// closes what a test left open, and gives the server a moment to free the places
afterEach(async () => {
    openStreams.splice(0).forEach((stream) => stream.close());
    await sleep(50);
});

after(async () => {
    server.close();
    fakeOllama.close();
    await pool.end();
});

describe("GET /v1/events", () => {
    it("requires a token", async () => {
        assert.equal((await request(app).get("/v1/events")).status, 401);
    });

    it("opens a stream of server-sent events that is never cached", async () => {
        const ana = await createTestUser("ana@example.com");

        const stream = await openStream(ana.token);

        assert.equal(stream.status, 200);
        assert.match(String(stream.headers["content-type"]), /^text\/event-stream/);
        assert.equal(stream.headers["cache-control"], "no-store");
        await waitFor(() => stream.frames[0] === ": connected", "the stream starts with a comment");
    });

    it("sends each user only their own events, without the user id", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const anaStream = await openStream(ana.token);
        const bobStream = await openStream(bob.token);
        await waitFor(() => anaStream.frames.length > 0 && bobStream.frames.length > 0, "both streams are open");

        emitEvent({ type: "question_queued", userId: ana.id, position: 2 });
        emitEvent({ type: "question_started", userId: bob.id });

        await waitFor(() => eventsIn(anaStream).length === 1 && eventsIn(bobStream).length === 1, "each stream gets one event");
        assert.deepEqual(eventsIn(anaStream), [{ type: "question_queued", data: { position: 2 } }]);
        assert.deepEqual(eventsIn(bobStream), [{ type: "question_started", data: {} }]);
    });

    it("sends a heartbeat while nothing happens", async () => {
        const ana = await createTestUser("ana@example.com");

        const stream = await openStream(ana.token);

        await waitFor(() => stream.frames.includes(": heartbeat"), "a heartbeat arrives", 2500);
    });

    it("allows two streams per user, and frees the place when one closes", async () => {
        const ana = await createTestUser("ana@example.com");
        const first = await openStream(ana.token);
        assert.equal((await openStream(ana.token)).status, 200);

        const third = await openStream(ana.token);
        await endOf(third);
        assert.equal(third.status, 429);
        assert.deepEqual(JSON.parse(third.body()), { message: "Too many open event streams for this account (2): close one first" });

        first.close();
        await sleep(50);
        assert.equal((await openStream(ana.token)).status, 200, "the closed stream gave its place back");
    });

    it("answers 503 when the server already has the maximum number of streams open", async () => {
        const users = await Promise.all(["a@example.com", "b@example.com", "c@example.com"].map((email) => createTestUser(email)));
        await openStream(users[0].token);
        await openStream(users[0].token);
        await openStream(users[1].token);

        const refused = await openStream(users[2].token);
        await endOf(refused);

        assert.equal(refused.status, 503);
        assert.deepEqual(JSON.parse(refused.body()), { message: "The server is busy, please try again in a few minutes" });
    });

    it("closes the stream when the token expires", async () => {
        const ana = await createTestUser("ana@example.com");
        const shortToken = jwt.sign({ id: ana.id, role: "user" }, SECRET, { algorithm: "HS256", expiresIn: 2 });

        const stream = await openStream(shortToken);
        const closedInTime = await Promise.race([stream.ended.then(() => true), sleep(3500).then(() => false)]);

        assert.equal(stream.status, 200);
        assert.equal(closedInTime, true, "the server ended the stream at the token's expiry");
    });
});

describe("GET /v1/events: what the stream reports", () => {
    it("tells the owner of a waiting document its place in line, then its indexing", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const anaStream = await openStream(ana.token);
        const bobStream = await openStream(bob.token);

        await request(app).post("/v1/documents").set(...ana.auth).send({ filename: "a.txt", text: "A short text." });
        await waitFor(() => eventsIn(anaStream).length === 1, "Ana hears her place");
        await request(app).post("/v1/documents").set(...bob.auth).send({ filename: "b.txt", text: "Another short text." });
        await waitFor(() => eventsIn(bobStream).length === 1, "Bob hears his place");

        await processQueuedJobsService();
        await waitFor(() => eventsIn(bobStream).some((event) => event.type === "done"), "Bob's document is ready");

        assert.deepEqual(eventsIn(bobStream).map((event) => [event.type, event.data.position ?? null]), [
            ["queued", 2],
            ["queued", 1],
            ["started", null],
            ["progress", null],
            ["done", null]
        ]);
        assert.deepEqual(eventsIn(anaStream).map((event) => event.type), ["queued", "queued", "started", "progress", "done"]);
    });

    it("tells a question waiting for the model its place, then when its turn comes", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const anaDocument = await createReadyDocument(ana.id);
        const bobDocument = await createReadyDocument(bob.id);
        const bobStream = await openStream(bob.token);
        chatDelayMs = 300;

        const anaAnswer = request(app).post(`/v1/documents/${anaDocument}/ask`).set(...ana.auth).send({ question: "What?" }).then((response) => response);
        await sleep(50);
        const bobAnswer = await request(app).post(`/v1/documents/${bobDocument}/ask`).set(...bob.auth).send({ question: "What?" });

        assert.equal((await anaAnswer).status, 200);
        assert.equal(bobAnswer.status, 200);
        assert.deepEqual(eventsIn(bobStream), [
            { type: "question_queued", data: { position: 1 } },
            { type: "question_started", data: {} }
        ]);
    });
});
