import type { ChunkText, ScoredChunk } from "../types/chunks.type.js";
import type { Fragment } from "../types/answers.type.js";

// Chunk positions right before and after each match that are not matches themselves.
// Positions past the end of the document are not filtered here; looking them up simply finds nothing.
export const getNeighborIndexes = (matches: ScoredChunk[]): number[] => {
    const matchIndexes = new Set(matches.map((match) => match.chunkIndex));
    const neighborIndexes = new Set<number>();

    for (const match of matches) {
        for (const index of [match.chunkIndex - 1, match.chunkIndex + 1]) {
            if (index >= 0 && !matchIndexes.has(index)) {
                neighborIndexes.add(index);
            }
        }
    }

    return [...neighborIndexes];
};

// Matches first (best score first), then each match's previous and next chunk, without duplicates.
// Same order as RAG1, so the ids F1..Fn the model sees are the ones it was evaluated with.
export const buildFragments = (matches: ScoredChunk[], neighbors: ChunkText[]): Fragment[] => {
    const neighborsByIndex = new Map(neighbors.map((neighbor) => [neighbor.chunkIndex, neighbor]));
    const included = new Set(matches.map((match) => match.chunkIndex));
    const ordered: Omit<Fragment, "id">[] = matches.map((match) => ({
        chunkIndex: match.chunkIndex,
        text: match.text,
        retrieval: "match",
        score: match.score
    }));

    for (const match of matches) {
        for (const index of [match.chunkIndex - 1, match.chunkIndex + 1]) {
            const neighbor = neighborsByIndex.get(index);

            if (neighbor === undefined || included.has(index)) {
                continue;
            }

            ordered.push({ chunkIndex: neighbor.chunkIndex, text: neighbor.text, retrieval: "neighbor" });
            included.add(index);
        }
    }

    return ordered.map((fragment, position) => ({ id: `F${position + 1}`, ...fragment }));
};
