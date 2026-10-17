import type { JobEvent } from "./jobs.type.js";

// What happens to the user's question while it waits for the model; the answer itself comes in the POST
// response. A user has at most one question at a time, so these events need no id.
export type QuestionEvent =
    | { type: "question_queued"; userId: string; position: number }
    | { type: "question_started"; userId: string };

// everything the live stream (GET /v1/events) can send; each event goes only to its userId
export type LiveEvent = JobEvent | QuestionEvent;
