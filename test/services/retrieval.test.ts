import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../src/v1/config/db.config.js";
import { findFragmentsService } from "../../src/v1/services/retrieval.service.js";
import { resetTestDatabase } from "../db/testDatabase.js";

const vector = (weights: Record<number, number>): string => JSON.stringify(Array.from({ length: 1024 }, (_, index) => weights[index] ?? 0));
const QUESTION = Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0));

const createUser = async (email: string): Promise<string> =>
    (await pool.query<{ id: string }>("INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id", [email])).rows[0].id;

before(resetTestDatabase);

beforeEach(() => pool.query("TRUNCATE users CASCADE"));

after(() => pool.end());

describe("findFragmentsService", () => {
    it("searches only the chunks of a document that belongs to the given user", async () => {
        const anaId = await createUser("ana@example.com");
        const bobId = await createUser("bob@example.com");
        const { rows: [document] } = await pool.query<{ id: string }>(
            "INSERT INTO documents (user_id, filename, status) VALUES ($1, 'a.txt', 'ready') RETURNING id",
            [anaId]
        );
        await pool.query("INSERT INTO chunks (document_id, chunk_index, text, embedding) VALUES ($1, 0, 'match', $2::vector)", [document.id, vector({ 0: 1 })]);

        assert.equal((await findFragmentsService(anaId, document.id, QUESTION)).length, 1);
        assert.deepEqual(await findFragmentsService(bobId, document.id, QUESTION), []);
    });

    it("skips chunks that do not have their embedding yet", async () => {
        const anaId = await createUser("ana@example.com");
        const { rows: [document] } = await pool.query<{ id: string }>(
            "INSERT INTO documents (user_id, filename, status) VALUES ($1, 'a.txt', 'indexing') RETURNING id",
            [anaId]
        );
        await pool.query("INSERT INTO chunks (document_id, chunk_index, text) VALUES ($1, 0, 'no vector yet')", [document.id]);

        assert.deepEqual(await findFragmentsService(anaId, document.id, QUESTION), []);
    });
});
