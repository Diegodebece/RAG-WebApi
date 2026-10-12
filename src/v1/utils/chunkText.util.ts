import { CHUNK_MAX_CHARS } from "../config/rag.config.js";

// Sizes are JavaScript string lengths (UTF-16 code units), the same unit as RAG1 and the upload length limit.
// One code point can take two units (emoji, rare CJK characters), so a smaller limit cannot always be met.
const MIN_CHUNK_CHARS = 2;

// Words longer than a chunk (URLs, base64, text in languages written without spaces) are cut into pieces
// instead of failing the whole document. Iterating by code point never splits an emoji or other surrogate pair,
// and since maxChars is at least 2, every code point fits in a piece.
const splitLongWord = (word: string, maxChars: number): string[] => {
    if (word.length <= maxChars) {
        return [word];
    }

    const pieces: string[] = [];
    let piece = "";

    for (const character of word) {
        if (piece !== "" && piece.length + character.length > maxChars) {
            pieces.push(piece);
            piece = "";
        }
        piece += character;
    }

    pieces.push(piece);
    return pieces;
};

// Packs whole words into chunks of at most maxChars characters, with no overlap (RAG1's evaluated chunking).
// Any run of whitespace, including line breaks, becomes a single space.
export const chunkText = (text: string, maxChars: number = CHUNK_MAX_CHARS): string[] => {
    if (!Number.isInteger(maxChars) || maxChars < MIN_CHUNK_CHARS) {
        throw new RangeError(`The maximum chunk size must be an integer of at least ${MIN_CHUNK_CHARS}`);
    }

    const trimmedText = text.trim();

    if (trimmedText === "") {
        return [];
    }

    const words = trimmedText.split(/\s+/).flatMap((word) => splitLongWord(word, maxChars));
    const chunks: string[] = [];
    let currentChunk = "";

    for (const word of words) {
        const candidate = currentChunk === "" ? word : `${currentChunk} ${word}`;

        if (candidate.length > maxChars) {
            chunks.push(currentChunk);
            currentChunk = word;
        } else {
            currentChunk = candidate;
        }
    }

    chunks.push(currentChunk);
    return chunks;
};
