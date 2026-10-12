import type { Fragment } from "../types/answers.type.js";

// one citation: [F1], or a list such as [F1, F2] or [F1; F3]
const CITATION = /\[\s*(F\d+(?:\s*[,;]\s*F\d+)*)\s*\]/g;

const FRAGMENT_ID = /\bF\d+\b/g;

// Ids cited in brackets, in order of first appearance, without duplicates.
export const extractCitationIds = (answer: string): string[] => [
    ...new Set([...answer.matchAll(CITATION)].flatMap((match) => match[1].match(FRAGMENT_ID) ?? []))
];

// Structured-mode rule: at least one citation, and every cited id must belong to a fragment sent to the model.
// An F-id outside brackets ("see F9") also counts as a citation attempt, unless the same term appears in the
// fragments' text: then it is document content, such as the F5 key or an F16 jet, not a reference.
export const hasValidCitations = (answer: string, fragments: Fragment[]): boolean => {
    const citedIds = extractCitationIds(answer);

    if (citedIds.length === 0) {
        return false;
    }

    const knownIds = new Set(fragments.map((fragment) => fragment.id));
    const sourceTerms = new Set(fragments.flatMap((fragment) => fragment.text.match(FRAGMENT_ID) ?? []));
    const bareIds = answer.replace(CITATION, " ").match(FRAGMENT_ID) ?? [];

    return citedIds.every((id) => knownIds.has(id))
        && bareIds.every((id) => knownIds.has(id) || sourceTerms.has(id));
};
