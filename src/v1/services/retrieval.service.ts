import { pool } from "../config/db.config.js";
import { RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K } from "../config/rag.config.js";
import { buildFragments, getNeighborIndexes } from "../utils/fragments.util.js";
import type { Fragment } from "../types/answers.type.js";
import type { ChunkText, ScoredChunk } from "../types/chunks.type.js";

// The fragments for a question: the closest chunks of one of the user's documents (top 3, cosine similarity
// of at least 0.30, as evaluated in RAG1) followed by their neighbors. An empty list means no chunk was close
// enough. The search scans the document's chunks without an index: a few hundred vectors take milliseconds.
export const findFragmentsService = async (userId: string, documentId: string, questionVector: number[]): Promise<Fragment[]> => {
    const vector = JSON.stringify(questionVector);

    // <=> is the cosine distance, so 1 - distance is the similarity; ties keep the document's order
    const { rows: matches } = await pool.query<ScoredChunk>(
        `SELECT c.chunk_index AS "chunkIndex", c.text, (1 - (c.embedding <=> $3::vector))::float8 AS score
         FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE c.document_id = $1 AND d.user_id = $2 AND c.embedding IS NOT NULL
           AND 1 - (c.embedding <=> $3::vector) >= $4
         ORDER BY c.embedding <=> $3::vector, c.chunk_index
         LIMIT $5`,
        [documentId, userId, vector, RETRIEVAL_MIN_SCORE, RETRIEVAL_TOP_K]
    );

    if (matches.length === 0) {
        return [];
    }

    // the matches already proved the document belongs to the user
    const { rows: neighbors } = await pool.query<ChunkText>(
        `SELECT chunk_index AS "chunkIndex", text FROM chunks WHERE document_id = $1 AND chunk_index = ANY($2::int[])`,
        [documentId, getNeighborIndexes(matches)]
    );

    return buildFragments(matches, neighbors);
};
