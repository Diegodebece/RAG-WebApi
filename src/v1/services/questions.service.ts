import { performance } from "node:perf_hooks";
import { pool, withTransaction } from "../config/db.config.js";
import {
    DAILY_LIMIT_WINDOW_HOURS,
    MAX_QUESTION_WAIT_SECONDS,
    MAX_QUESTIONS_PER_DAY,
    MAX_WAITING_QUESTIONS
} from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import { decideAnswerStatus } from "../utils/answerStatus.util.js";
import { extractCitationIds } from "../utils/citations.util.js";
import { buildAnswerMessages, INSUFFICIENT_EVIDENCE_ANSWERS } from "../utils/prompts.util.js";
import { interpretStructuredAnswer } from "../utils/structuredAnswer.util.js";
import { isUuid } from "../utils/uuid.util.js";
import { getModelTurnWaitingCount, runWithModelTurnService } from "./modelTurn.service.js";
import { chatService, embedTextsService } from "./ollama.service.js";
import { findFragmentsService } from "./retrieval.service.js";
import type { AnswerLanguage, AnswerMode, AnswerSource, Fragment, QuestionAnswer } from "../types/answers.type.js";
import type { DocumentStatus } from "../types/documents.type.js";
import type { AskQuestionInput } from "../validators/questions.validator.js";

const NOT_READY_MESSAGES: Record<Exclude<DocumentStatus, "ready">, string> = {
    pending: "The document is still being indexed; ask again when it is ready",
    indexing: "The document is still being indexed; ask again when it is ready",
    failed: "The document could not be indexed; delete it and upload it again"
};

// Users with a question waiting or being answered. One at a time per user, so nobody fills the line alone.
// In memory, like the line itself: both empty when the API restarts.
const usersWithPendingQuestion = new Set<string>();

const elapsedSince = (start: number): number => Math.round(performance.now() - start);

const toSources = (fragments: Fragment[]): AnswerSource[] => fragments.map((fragment) => ({
    id: fragment.id,
    chunkNumber: fragment.chunkIndex + 1,
    text: fragment.text,
    retrieval: fragment.retrieval,
    ...(fragment.score === undefined ? {} : { score: fragment.score })
}));

// The question's document, only when it belongs to the user and is ready to be asked.
const getReadyDocument = async (userId: string, documentId: string): Promise<{ filename: string }> => {
    const { rows } = isUuid(documentId)
        ? await pool.query<{ filename: string; status: DocumentStatus }>(
            "SELECT filename, status FROM documents WHERE id = $1 AND user_id = $2",
            [documentId, userId]
        )
        : { rows: [] };

    if (rows.length === 0) {
        throw new AppError(404, "Document not found");
    }

    const { filename, status } = rows[0];

    if (status !== "ready") {
        throw new AppError(409, NOT_READY_MESSAGES[status]);
    }

    return { filename };
};

// Counts the question for the daily limit when it is accepted, before the model is asked; it is not given
// back if the answer fails later. Locking the user's row keeps two requests from both passing the limit.
const recordQuestion = async (userId: string): Promise<void> => {
    await withTransaction(async (client) => {
        const { rows: users } = await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);

        if (users.length === 0) {
            throw new AppError(404, "User not found");
        }

        const { rows: [usage] } = await client.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM question_usage WHERE user_id = $1 AND asked_at > now() - make_interval(hours => $2)",
            [userId, DAILY_LIMIT_WINDOW_HOURS]
        );

        if (usage.count >= MAX_QUESTIONS_PER_DAY) {
            throw new AppError(429, `Daily question limit reached (${MAX_QUESTIONS_PER_DAY}): try again tomorrow`);
        }

        // a full line is answered before the question is counted, so a busy server costs the user nothing
        if (getModelTurnWaitingCount() >= MAX_WAITING_QUESTIONS) {
            throw new AppError(503, "The server is busy, please try again in a few minutes");
        }

        await client.query("INSERT INTO question_usage (user_id) VALUES ($1)", [userId]);
    });
};

// Baseline returns the model's text as it is. Structured mode returns JSON that must follow its contract;
// a reply that breaks it (no citations, invented citations, empty answer) becomes the fallback sentence,
// because an answer that cannot be checked should not be shown. Only the reason is logged, never the
// reply, which may quote the user's document.
const generateAnswer = async (
    question: string,
    fragments: Fragment[],
    filename: string,
    mode: AnswerMode,
    language: AnswerLanguage,
    signal?: AbortSignal
): Promise<string> => {
    const messages = buildAnswerMessages(mode, question, fragments, filename, language);

    if (mode === "baseline") {
        return await chatService(messages, { signal });
    }

    const raw = await chatService(messages, { format: "json", signal });

    try {
        return interpretStructuredAnswer(raw, fragments, language);
    } catch (error) {
        console.warn(`Structured answer rejected: ${error instanceof Error ? error.message : String(error)}`);
        return INSUFFICIENT_EVIDENCE_ANSWERS[language];
    }
};

// Answers a question about one of the user's documents within the request. The question waits for its turn
// with the model (at most MAX_QUESTION_WAIT_SECONDS), then the question is embedded, the closest chunks are
// found and the model answers. The signal takes the question out of the line, or stops the model, when the
// browser disconnects.
export const askQuestionService = async (
    userId: string,
    documentId: string,
    questionData: AskQuestionInput,
    signal?: AbortSignal
): Promise<QuestionAnswer> => {
    const started = performance.now();
    const mode = questionData.mode ?? "baseline";
    const language = questionData.language ?? "en";
    const { filename } = await getReadyDocument(userId, documentId);

    if (usersWithPendingQuestion.has(userId)) {
        throw new AppError(409, "You already have a question waiting for an answer");
    }

    usersWithPendingQuestion.add(userId);

    try {
        await recordQuestion(userId);
        const queued = performance.now();

        return await runWithModelTurnService(async () => {
            const waitMs = elapsedSince(queued);

            const embeddingStarted = performance.now();
            const [questionVector] = await embedTextsService([questionData.question]);
            const embeddingMs = elapsedSince(embeddingStarted);

            const retrievalStarted = performance.now();
            const fragments = await findFragmentsService(userId, documentId, questionVector);
            const retrievalMs = elapsedSince(retrievalStarted);

            // no chunk is close enough: the model is not asked, and the frontend shows the fallback sentence
            if (fragments.length === 0) {
                return {
                    status: "no_match",
                    answer: INSUFFICIENT_EVIDENCE_ANSWERS[language],
                    citations: [],
                    sources: [],
                    timings: { waitMs, embeddingMs, retrievalMs, answerMs: 0, totalMs: elapsedSince(started) }
                };
            }

            const answerStarted = performance.now();
            const answer = await generateAnswer(questionData.question, fragments, filename, mode, language, signal);
            const answerMs = elapsedSince(answerStarted);

            const matchCount = fragments.filter((fragment) => fragment.retrieval === "match").length;
            const status = decideAnswerStatus(matchCount, answer);
            const knownIds = new Set(fragments.map((fragment) => fragment.id));

            return {
                status,
                answer,
                // ids the answer cites that were really sent to the model; baseline answers are not checked,
                // so an invented id stays in the text but is not listed here
                citations: status === "answered" ? extractCitationIds(answer).filter((id) => knownIds.has(id)) : [],
                sources: toSources(fragments),
                timings: { waitMs, embeddingMs, retrievalMs, answerMs, totalMs: elapsedSince(started) }
            };
        }, { maxWaitMs: MAX_QUESTION_WAIT_SECONDS * 1000, signal });
    } finally {
        usersWithPendingQuestion.delete(userId);
    }
};
