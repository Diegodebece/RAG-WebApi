import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFragments, getNeighborIndexes } from "../../src/v1/utils/fragments.util.js";
import type { ChunkText, ScoredChunk } from "../../src/v1/types/chunks.type.js";

const match = (chunkIndex: number, score: number): ScoredChunk => ({ chunkIndex, text: `chunk ${chunkIndex}`, score });

const chunk = (chunkIndex: number): ChunkText => ({ chunkIndex, text: `chunk ${chunkIndex}` });

describe("getNeighborIndexes", () => {
    it("returns the previous and next position of each match", () => {
        assert.deepEqual(getNeighborIndexes([match(5, 0.9), match(10, 0.8)]), [4, 6, 9, 11]);
    });

    it("skips negative positions, positions that are matches, and duplicates", () => {
        assert.deepEqual(getNeighborIndexes([match(0, 0.9), match(1, 0.8), match(3, 0.7)]), [2, 4]);
    });

    it("returns nothing when there are no matches", () => {
        assert.deepEqual(getNeighborIndexes([]), []);
    });
});

describe("buildFragments", () => {
    it("puts matches first in score order, then each match's previous and next chunk", () => {
        const fragments = buildFragments([match(5, 0.9), match(10, 0.8)], [chunk(4), chunk(6), chunk(9), chunk(11)]);

        assert.deepEqual(fragments.map((fragment) => [fragment.id, fragment.chunkIndex, fragment.retrieval]), [
            ["F1", 5, "match"],
            ["F2", 10, "match"],
            ["F3", 4, "neighbor"],
            ["F4", 6, "neighbor"],
            ["F5", 9, "neighbor"],
            ["F6", 11, "neighbor"]
        ]);
    });

    it("keeps the score on matches only", () => {
        const [first, neighbor] = buildFragments([match(2, 0.75)], [chunk(1)]);

        assert.equal(first.score, 0.75);
        assert.equal(neighbor.score, undefined);
    });

    it("includes a chunk shared by two matches only once", () => {
        const fragments = buildFragments([match(3, 0.9), match(5, 0.8)], [chunk(2), chunk(4), chunk(6)]);

        assert.deepEqual(fragments.map((fragment) => fragment.chunkIndex), [3, 5, 2, 4, 6]);
    });

    it("never adds a match again as a neighbor", () => {
        const fragments = buildFragments([match(4, 0.9), match(5, 0.8)], [chunk(3), chunk(6)]);

        assert.deepEqual(fragments.map((fragment) => fragment.chunkIndex), [4, 5, 3, 6]);
    });

    it("skips neighbors that do not exist, such as past the end of the document", () => {
        const fragments = buildFragments([match(0, 0.9)], []);

        assert.deepEqual(fragments.map((fragment) => fragment.id), ["F1"]);
    });

    it("returns no fragments when there are no matches", () => {
        assert.deepEqual(buildFragments([], [chunk(1)]), []);
    });
});
