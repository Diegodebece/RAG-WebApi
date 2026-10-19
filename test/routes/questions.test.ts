import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";

// --- a fake Ollama: /api/embed answers questionVector for every text, /api/chat answers chatReply ---

interface OllamaRequest {
    path: string;
    body: {
        model?: string;
        input?: string[];
        messages?: { role: string; content: string }[];
        stream?: boolean;
        think?: boolean;
        format?: string;
        options?: unknown;
    };
}

type ChatMode = "ok" | "drop-connection" | "slow" | "empty";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let questionVector: number[] = [];
let chatReply = "";
let chatMode: ChatMode = "ok";
let chatDelayMs = 0;
let embedDelayMs = 0;
let requests: OllamaRequest[] = [];
// Ollama requests being handled right now, and the most at the same time
let active = 0;
let maxActive = 0;

const fakeOllama = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) {
        raw += chunk;
    }
    const body: OllamaRequest["body"] = JSON.parse(raw);
    requests.push({ path: req.url ?? "", body });
    active++;
    maxActive = Math.max(maxActive, active);

    try {
        if (req.url === "/api/embed") {
            await sleep(embedDelayMs);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ embeddings: (body.input ?? []).map(() => questionVector) }));
            return;
        }

        if (chatMode === "drop-connection") {
            req.socket.destroy();
            return;
        }

        // slow: longer than OLLAMA_TIMEOUT_MS below
        await sleep(chatMode === "slow" ? 2300 : chatDelayMs);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: { role: "assistant", content: chatMode === "empty" ? "  " : chatReply }, done: true }));
    } finally {
        active--;
    }
});

await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${(fakeOllama.address() as AddressInfo).port}`;
process.env.OLLAMA_TIMEOUT_MS = "2000";
process.env.SECRET_KEY = "test-secret-only-for-these-tests-0123456789";
process.env.MAX_QUESTIONS_PER_DAY = "3";
process.env.QUESTIONS_PER_MINUTE = "1000";
process.env.MAX_QUESTION_SECONDS = "2";
process.env.MAX_WAITING_QUESTIONS = "3";

const { app } = await import("../../src/app.js");
const { pool } = await import("../../src/v1/config/db.config.js");
const { resetTestDatabase } = await import("../db/testDatabase.js");
const { createTestUser } = await import("./testUsers.js");
const { processQueuedJobsService } = await import("../../src/v1/services/jobQueue.service.js");
const { INSUFFICIENT_EVIDENCE_ANSWERS } = await import("../../src/v1/utils/prompts.util.js");
const { loadModelsService } = await import("../../src/v1/services/ollama.service.js");
const { runWithModelTurnService } = await import("../../src/v1/services/modelTurn.service.js");

// holds the turn with the model for ms, as a long indexing batch or another answer would
const holdModelTurn = (ms: number) => runWithModelTurnService(() => sleep(ms));

type Auth = [string, string];

// --- a ready document whose chunks have known vectors ---

const vector = (weights: Record<number, number>): number[] => Array.from({ length: 1024 }, (_, index) => weights[index] ?? 0);
const E0 = vector({ 0: 1 });
const E1 = vector({ 1: 1 });
const E2 = vector({ 2: 1 });

// Against a question equal to E0: chunks 1, 3 and 6 match (similarity 1.0, 0.6 and 0.4), chunk 7 is under
// the 0.30 minimum (0.2), and the rest are unrelated (0).
const CHUNK_VECTORS = [
    E1,
    E0,
    E1,
    vector({ 0: 0.6, 1: 0.8 }),
    E1,
    E1,
    vector({ 0: 0.4, 1: Math.sqrt(1 - 0.16) }),
    vector({ 0: 0.2, 1: Math.sqrt(1 - 0.04) })
];

const createDocument = async (userId: string, status = "ready"): Promise<string> => {
    const { rows: [document] } = await pool.query<{ id: string }>(
        "INSERT INTO documents (user_id, filename, status, chunk_count) VALUES ($1, 'notes.txt', $2, $3) RETURNING id",
        [userId, status, CHUNK_VECTORS.length]
    );
    await pool.query(
        `INSERT INTO chunks (document_id, chunk_index, text, embedding)
         SELECT $1, position - 1, 'Chunk ' || (position - 1), embedding::vector
         FROM unnest($2::text[]) WITH ORDINALITY AS t(embedding, position)`,
        [document.id, CHUNK_VECTORS.map((chunkVector) => JSON.stringify(chunkVector))]
    );
    return document.id;
};

const ask = (auth: Auth, documentId: string, body: object = { question: "What is it?" }) =>
    request(app).post(`/v1/documents/${documentId}/ask`).set(...auth).send(body);

const chatRequests = () => requests.filter((entry) => entry.path === "/api/chat");
const embedRequests = () => requests.filter((entry) => entry.path === "/api/embed");

const countQuestions = async (userId: string): Promise<number> =>
    (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM question_usage WHERE user_id = $1", [userId])).rows[0].count;

before(resetTestDatabase);

beforeEach(async () => {
    await pool.query("TRUNCATE users CASCADE");
    questionVector = E0;
    chatReply = "";
    chatMode = "ok";
    chatDelayMs = 0;
    embedDelayMs = 0;
    requests = [];
    active = 0;
    maxActive = 0;
});

after(async () => {
    fakeOllama.close();
    await pool.end();
});

describe("POST /v1/documents/:id/ask: answers", () => {
    it("answers in baseline mode with the cited fragments, their sources and the timings", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = "It is the first thing [F1] and the second [F2].";

        const response = await ask(ana.auth, documentId);

        assert.equal(response.status, 200);
        const { status, answer, citations, sources, timings } = response.body.data;
        assert.equal(status, "answered");
        assert.equal(answer, chatReply);
        assert.deepEqual(citations, ["F1", "F2"]);

        // matches best first, then each match's neighbors, as in RAG1
        assert.deepEqual(
            sources.map((source: { id: string; chunkNumber: number; retrieval: string }) => [source.id, source.chunkNumber, source.retrieval]),
            [["F1", 2, "match"], ["F2", 4, "match"], ["F3", 7, "match"], ["F4", 1, "neighbor"], ["F5", 3, "neighbor"], ["F6", 5, "neighbor"], ["F7", 6, "neighbor"], ["F8", 8, "neighbor"]]
        );
        assert.equal(sources[0].text, "Chunk 1");
        assert.ok(Math.abs(sources[0].score - 1) < 1e-6 && Math.abs(sources[1].score - 0.6) < 1e-6 && Math.abs(sources[2].score - 0.4) < 1e-6);
        assert.ok(!("score" in sources[3]), "neighbors have no score");

        for (const key of ["waitMs", "embeddingMs", "retrievalMs", "answerMs", "totalMs"]) {
            assert.ok(Number.isInteger(timings[key]) && timings[key] >= 0, key);
        }
    });

    it("asks the model like RAG1: evaluated options, no thinking, the question and fragments as JSON data", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = "Answer [F1].";

        await ask(ana.auth, documentId, { question: "  What is it?  " });

        assert.deepEqual(embedRequests()[0].body.input, ["What is it?"]);
        const [chat] = chatRequests();
        assert.equal(chat.body.model, "qwen3.5:4b");
        assert.equal(chat.body.stream, false);
        assert.equal(chat.body.think, false);
        assert.equal(chat.body.format, undefined);
        // the evaluated options, plus a cap on the answer's length
        assert.deepEqual(chat.body.options, { temperature: 0, seed: 42, num_ctx: 8192, num_predict: 1024 });

        const [system, user] = chat.body.messages ?? [];
        assert.ok(system.content.startsWith("Answer the user's question briefly in English."));
        const data = JSON.parse(user.content);
        assert.equal(data.question, "What is it?");
        assert.deepEqual(data.fragments[0], { id: "F1", source: "notes.txt", fragment: 2, text: "Chunk 1" });
        assert.equal(data.fragments.length, 8);
    });

    it("lists only citations of fragments the model really received", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = "Something [F1] and more [F9].";

        const { body } = await ask(ana.auth, documentId);

        assert.equal(body.data.answer, chatReply);
        assert.deepEqual(body.data.citations, ["F1"]);
    });

    it("reports insufficient_evidence when the model replies with the fallback sentence", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = INSUFFICIENT_EVIDENCE_ANSWERS.en;

        const { body } = await ask(ana.auth, documentId);

        assert.equal(body.data.status, "insufficient_evidence");
        assert.deepEqual(body.data.citations, []);
        assert.equal(body.data.sources.length, 8);
    });

    it("answers no_match without asking the model when no chunk is close enough", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        questionVector = E2;

        const { body } = await ask(ana.auth, documentId);

        assert.equal(body.data.status, "no_match");
        assert.equal(body.data.answer, INSUFFICIENT_EVIDENCE_ANSWERS.en);
        assert.deepEqual(body.data.sources, []);
        assert.equal(body.data.timings.answerMs, 0);
        assert.equal(chatRequests().length, 0);
    });

    it("uses the Spanish instructions and fallback sentence when asked in Spanish", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = "Es el primero [F1].";

        await ask(ana.auth, documentId, { question: "Que es?", language: "es" });
        questionVector = E2;
        const noMatch = await ask(ana.auth, documentId, { question: "Que es?", language: "es" });

        assert.ok(chatRequests()[0].body.messages?.[0].content.startsWith("Responde brevemente en "));
        assert.equal(noMatch.body.data.answer, INSUFFICIENT_EVIDENCE_ANSWERS.es);
    });
});

describe("POST /v1/documents/:id/ask: structured mode", () => {
    it("asks for JSON and returns the answer of an answerable reply", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = JSON.stringify({ answerable: true, answer: "It is chunk two [F2]." });

        const { body } = await ask(ana.auth, documentId, { question: "What is it?", mode: "structured" });

        assert.equal(body.data.status, "answered");
        assert.equal(body.data.answer, "It is chunk two [F2].");
        assert.deepEqual(body.data.citations, ["F2"]);
        assert.equal(chatRequests()[0].body.format, "json");
        assert.ok(chatRequests()[0].body.messages?.[0].content.startsWith("Answer the user's question briefly in English using only the provided chunks."));
    });

    it("turns answerable: false into the fallback sentence", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = JSON.stringify({ answerable: false, answer: "" });

        const { body } = await ask(ana.auth, documentId, { question: "What is it?", mode: "structured" });

        assert.equal(body.data.status, "insufficient_evidence");
        assert.equal(body.data.answer, INSUFFICIENT_EVIDENCE_ANSWERS.en);
    });

    it("abstains, and logs the reason, when the reply breaks the structured contract", async (t) => {
        const warn = t.mock.method(console, "warn", () => {});
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        const replies = {
            "no citation": JSON.stringify({ answerable: true, answer: "No citation here." }),
            "invented citation": JSON.stringify({ answerable: true, answer: "Made up [F9]." }),
            "not JSON": "plain text"
        };

        for (const [label, reply] of Object.entries(replies)) {
            chatReply = reply;
            const { body } = await ask(ana.auth, documentId, { question: "What is it?", mode: "structured" });

            assert.equal(body.data.status, "insufficient_evidence", label);
            assert.equal(body.data.answer, INSUFFICIENT_EVIDENCE_ANSWERS.en, label);
        }

        assert.equal(warn.mock.callCount(), 3);
        assert.ok(!String(warn.mock.calls[0].arguments[0]).includes("No citation here"), "the reply itself is not logged");
    });
});

describe("POST /v1/documents/:id/ask: who can ask what", () => {
    it("validates the question, the mode and the language", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        const cases = {
            "no question": {},
            "blank question": { question: "   " },
            "question over 1,000 characters": { question: "x".repeat(1001) },
            "question that is not a string": { question: 42 },
            "unknown mode": { question: "What?", mode: "fast" },
            "unknown language": { question: "What?", language: "fr" }
        };

        for (const [label, body] of Object.entries(cases)) {
            assert.equal((await ask(ana.auth, documentId, body)).status, 400, label);
        }

        assert.equal(await countQuestions(ana.id), 0);
    });

    it("answers another user's document, an unknown id and a malformed id with the same 404", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const documentId = await createDocument(ana.id);

        for (const id of [documentId, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
            const response = await ask(bob.auth, id);
            assert.equal(response.status, 404, id);
            assert.deepEqual(response.body, { message: "Document not found" }, id);
        }

        assert.equal(await countQuestions(bob.id), 0);
        assert.equal(requests.length, 0, "Ollama is never asked about another user's document");
    });

    it("answers 409 while the document is not ready", async () => {
        const ana = await createTestUser("ana@example.com");

        for (const [status, message] of [["pending", /still being indexed/], ["indexing", /still being indexed/], ["failed", /could not be indexed/]] as const) {
            const response = await ask(ana.auth, await createDocument(ana.id, status));
            assert.equal(response.status, 409, status);
            assert.match(response.body.message, message, status);
        }

        assert.equal(await countQuestions(ana.id), 0);
    });

    it("allows the configured number of questions per user per day", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const documentId = await createDocument(ana.id);
        chatReply = "Answer [F1].";

        for (let index = 0; index < 3; index++) {
            assert.equal((await ask(ana.auth, documentId)).status, 200);
        }

        const before = requests.length;
        const fourth = await ask(ana.auth, documentId);
        assert.equal(fourth.status, 429);
        assert.deepEqual(fourth.body, { message: "Daily question limit reached (3): try again tomorrow" });
        assert.equal(requests.length, before, "a rejected question never reaches the model");

        assert.equal((await ask(bob.auth, await createDocument(bob.id))).status, 200, "the limit is per user");
    });

    it("does not count questions older than 24 hours", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        await pool.query("INSERT INTO question_usage (user_id, asked_at) SELECT $1, now() - interval '25 hours' FROM generate_series(1, 3)", [ana.id]);
        chatReply = "Answer [F1].";

        assert.equal((await ask(ana.auth, documentId)).status, 200);
    });

    it("reports question usage in GET /v1/users/me", async () => {
        const ana = await createTestUser("ana@example.com");
        chatReply = "Answer [F1].";
        await ask(ana.auth, await createDocument(ana.id));

        const response = await request(app).get("/v1/users/me").set(...ana.auth);

        assert.deepEqual(response.body.data.usage.questionsToday, { used: 1, limit: 3 });
    });
});

describe("POST /v1/documents/:id/ask: when Ollama fails", () => {
    it("answers 503 when Ollama cannot be reached", async () => {
        const ana = await createTestUser("ana@example.com");
        chatMode = "drop-connection";

        const response = await ask(ana.auth, await createDocument(ana.id));

        assert.equal(response.status, 503);
        assert.deepEqual(response.body, { message: "The model server is not available" });
        assert.equal(await countQuestions(ana.id), 0, "a question without an answer goes back to the daily limit");
    });

    it("answers 504 when Ollama does not answer in time", async () => {
        const ana = await createTestUser("ana@example.com");
        chatMode = "slow";

        const response = await ask(ana.auth, await createDocument(ana.id));

        assert.equal(response.status, 504);
        assert.deepEqual(response.body, { message: "The model server did not answer in time" });
        assert.equal(await countQuestions(ana.id), 0, "a question without an answer goes back to the daily limit");
        // let the fake finish its slow answer, so it does not overlap the next test
        await sleep(400);
    });

    it("stops at the question's total time, even while the model is still answering", async () => {
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);
        chatDelayMs = 1500;
        chatReply = "Answer [F1].";
        const holding = holdModelTurn(1000);
        const started = Date.now();

        // a second in line, then a 1.5-second answer: past the 2 seconds a question may take in total
        const response = await ask(ana.auth, documentId);

        assert.equal(response.status, 504);
        assert.ok(Date.now() - started < 2400, `answered after ${Date.now() - started} ms`);
        assert.equal(await countQuestions(ana.id), 0);
        await holding;
        await sleep(800);
    });

    it("answers a generic 500 when Ollama returns no text", async (t) => {
        t.mock.method(console, "error", () => {});
        const ana = await createTestUser("ana@example.com");
        chatMode = "empty";

        const response = await ask(ana.auth, await createDocument(ana.id));

        assert.equal(response.status, 500);
        assert.deepEqual(response.body, { message: "Internal server error" });
    });
});

describe("loadModelsService", () => {
    it("loads both models, the answer model with an empty chat and the options of real requests", async () => {
        await loadModelsService();

        assert.deepEqual(requests.map((entry) => entry.path), ["/api/embed", "/api/chat"]);
        const [, chat] = requests;
        assert.equal(chat.body.model, "qwen3.5:4b");
        assert.deepEqual(chat.body.messages, []);
        assert.deepEqual(chat.body.options, { temperature: 0, seed: 42, num_ctx: 8192 });
    });
});

describe("POST /v1/documents/:id/ask: the turn with the model", () => {
    it("never sends two requests to Ollama at the same time", async () => {
        chatDelayMs = 150;
        chatReply = "Answer [F1].";
        const users = await Promise.all(["a@example.com", "b@example.com", "c@example.com"].map((email) => createTestUser(email)));
        const documents = await Promise.all(users.map((user) => createDocument(user.id)));

        const responses = await Promise.all(users.map((user, index) => ask(user.auth, documents[index])));

        assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
        assert.equal(maxActive, 1);
        assert.ok(responses.some((response) => response.body.data.timings.waitMs >= 100), "someone waited for their turn");
    });

    it("allows one question at a time per user", async () => {
        chatDelayMs = 300;
        chatReply = "Answer [F1].";
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const documentId = await createDocument(ana.id);

        const first = ask(ana.auth, documentId).then((response) => response);
        await sleep(50);
        const [second, bobs] = await Promise.all([ask(ana.auth, documentId), ask(bob.auth, await createDocument(bob.id))]);

        assert.equal(second.status, 409);
        assert.deepEqual(second.body, { message: "You already have a question waiting for an answer" });
        assert.equal(bobs.status, 200, "other users can ask meanwhile");
        assert.equal((await first).status, 200);
        assert.equal(await countQuestions(ana.id), 1, "the refused question is not counted");
    });

    it("gives up with a 503, and gives the question back, when the turn does not come in time", async () => {
        const bob = await createTestUser("bob@example.com");
        const documentId = await createDocument(bob.id);
        const holding = holdModelTurn(2500);

        const late = await ask(bob.auth, documentId);

        assert.equal(late.status, 503);
        assert.deepEqual(late.body, { message: "The server is busy, please try again in a few minutes" });
        assert.equal(embedRequests().length, 0, "the late question never reached the model");
        assert.equal(await countQuestions(bob.id), 0);
        await holding;
    });

    it("never lets more questions wait than the limit, even when they arrive together", async () => {
        chatReply = "Answer [F1].";
        const users = await Promise.all(["a", "b", "c", "d", "e"].map((name) => createTestUser(`${name}@example.com`)));
        const documents = await Promise.all(users.map((user) => createDocument(user.id)));
        const holding = holdModelTurn(300);

        const responses = await Promise.all(users.map((user, index) => ask(user.auth, documents[index])));
        await holding;

        // three may wait for the model (MAX_WAITING_QUESTIONS); the others are told at once that it is busy
        assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200, 200, 503, 503]);
    });

    it("drops a question whose browser disconnected while it waited", async () => {
        chatDelayMs = 400;
        chatReply = "Answer [F1].";
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");

        const first = ask(ana.auth, await createDocument(ana.id)).then((response) => response);
        await sleep(50);
        // the client gives up after 100 ms and closes the connection
        await assert.rejects(ask(bob.auth, await createDocument(bob.id)).timeout(100));

        assert.equal((await first).status, 200);
        await sleep(100);
        assert.equal(embedRequests().length, 1, "Bob's question left the line");
        assert.equal(chatRequests().length, 1);
        assert.equal(await countQuestions(bob.id), 0, "and went back to his daily limit");
    });

    it("still counts a question whose browser disconnected while the model was answering", async () => {
        chatDelayMs = 400;
        chatReply = "Answer [F1].";
        const ana = await createTestUser("ana@example.com");
        const documentId = await createDocument(ana.id);

        // the client gives up while the model is answering, after using its time
        await assert.rejects(ask(ana.auth, documentId).timeout(150));
        await sleep(400);

        assert.equal(chatRequests().length, 1, "the model was asked");
        assert.equal(await countQuestions(ana.id), 1, "the question is not given back");
        assert.equal((await ask(ana.auth, documentId)).status, 200, "and the user can ask again");
    });

    it("lets a question in between the batches of a document being indexed", async () => {
        const ana = await createTestUser("ana@example.com");
        const bob = await createTestUser("bob@example.com");
        const readyDocument = await createDocument(ana.id);
        // 25 chunks of about 1,000 characters: indexed in batches of 10, 10 and 5
        const longText = Array.from({ length: 25 }, (_, index) => `Part ${index}. ${"word ".repeat(195)}`).join(" ");
        assert.equal((await request(app).post("/v1/documents").set(...bob.auth).send({ filename: "long.txt", text: longText })).status, 202);
        embedDelayMs = 100;
        chatReply = "Answer [F1].";

        const indexing = processQueuedJobsService();
        await sleep(30);
        const response = await ask(ana.auth, readyDocument);
        await indexing;

        assert.equal(response.status, 200);
        assert.equal(maxActive, 1, "the question and the indexing never use Ollama at the same time");
        const batchSizes = requests.map((entry) => (entry.path === "/api/chat" ? "chat" : entry.body.input?.length));
        assert.ok(batchSizes.indexOf("chat") < batchSizes.lastIndexOf(5), `the question was answered before the last batch: ${batchSizes.join(", ")}`);
    });
});
