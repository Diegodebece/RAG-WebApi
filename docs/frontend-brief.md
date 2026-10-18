# Frontend brief

Everything a new conversation needs to build the frontend of RAG-WebApi without reading the API's code. The API is finished and deployed; this document is its contract. The author decides the look and feel on top of it. For why the API works the way it does, see [project-guide.md](project-guide.md).

## The product

People register, upload a document (PDF, Word or plain text), and ask questions about it. Answers cite the passages they come from, and the frontend shows those passages. Each user only ever sees their own documents. Documents are deleted after 24 hours. Everything runs for free: the API and the models run on the author's laptop, so **the API can be offline** when the laptop is off.

## Where things live

| Part | Address | Notes |
|---|---|---|
| API | `https://rag-api.diegodebrun.com/v1` | On the author's laptop, behind a Cloudflare Tunnel |
| Frontend | `https://rag.diegodebrun.com` | Static files on Cloudflare Pages: no server code |
| Author's personal site | `https://diegodebrun.com` | A separate project |

**CORS:** the API only accepts browser calls from the origins listed in its `CORS_ORIGINS` setting, which is already set to `https://rag.diegodebrun.com` and `http://localhost:5173` (Vite's dev server). Another dev server address has to be added to `CORS_ORIGINS` in the API's `docker-compose.yml`, then `docker compose up -d api`.

### Still to decide with the author

- **Where the code lives:** a `frontend/` folder in this repository or a repository of its own.
- **The stack:** plain HTML, CSS and JavaScript, or a build tool such as Vite with or without a framework. The only constraint: the output must be static files for Cloudflare Pages.
- **The design and the language of the interface.** The API's messages are in English; a Spanish interface should translate them by status code and context (see the error table) instead of showing them as they are.

## How the API answers

- Success: `{ "success": true, "message": "...", "data": ... }`. Login and register also return `token` at the top level, next to `data`.
- Error: `{ "message": "..." }`. Validation errors (400) add `"details": ["Email is required", ...]`, one string per problem.
- Dates are ISO strings, for example `"2026-10-18T02:39:40.000Z"`.

| Status | Meaning |
|---|---|
| 400 | Invalid input (`details` says what) |
| 401 | No token, or an invalid or expired one: send the user to log in |
| 404 | Not found, or it belongs to someone else (the API never tells which) |
| 409 | Conflict with the account's state: a limit, a document still being indexed, a question already waiting |
| 413 | Body too large |
| 429 | A rate or daily limit |
| 503 | The server is busy or the model server is down: try again later |
| 504 | The model did not answer in time |
| 500 | Unexpected error |

## Authentication

```
POST /v1/auth/register   { "email": "ana@example.com", "password": "correct horse battery staple" }   -> 201
POST /v1/auth/login      same body                                                                     -> 200
```

Response:

```json
{
    "success": true,
    "message": "Logged in successfully",
    "data": { "id": "uuid", "email": "ana@example.com", "role": "user", "createdAt": "..." },
    "token": "eyJ..."
}
```

- Every protected request sends `Authorization: Bearer <token>`.
- The token lasts **1 hour** and cannot be refreshed: on any 401, clear it and show the login.
- Passwords: 8 to 64 characters, any characters, spaces count (do not trim them). Emails are trimmed and lowercased by the API.
- Errors: 409 "Email is already registered"; 401 "Invalid email or password" (the same for an unknown email); 429 after 3 accounts or 20 registration attempts per hour from one address, 10 logins per 15 minutes from one address, or 5 failed logins per email from one address.
- **Turnstile** (Cloudflare's mostly invisible bot check) is planned for registration: the form gets the widget, and its token travels with the request. The API side is not built yet; add both together.

## Endpoints

All under `https://rag-api.diegodebrun.com/v1`. All but `health` and `auth` need the token.

| Method and path | Body | Answer |
|---|---|---|
| `GET /health` | | `{ status: "ok" \| "degraded" \| "down", database: "up" \| "down", ollama: "up" \| "down" }` |
| `GET /users/me` | | The account plus `usage: { documents, uploadsToday, questionsToday }`, each `{ used, limit }` |
| `POST /documents` | `{ filename, text }` | 202, `{ document, jobId }` |
| `GET /documents` | | The user's documents, newest first |
| `GET /documents/:id` | | One document |
| `DELETE /documents/:id` | | 200, no `data` |
| `GET /jobs/:id` | | An indexing job's status, place in line and progress |
| `POST /documents/:id/ask` | `{ question, mode?, language? }` | The answer (below) |
| `GET /events` | | A stream of live events (below) |

A document:

```json
{
    "id": "uuid",
    "filename": "notes.pdf",
    "status": "pending | indexing | ready | failed",
    "chunkCount": 25,
    "createdAt": "...",
    "expiresAt": "..."
}
```

A job (`GET /jobs/:id`):

```json
{
    "id": "uuid",
    "type": "index_document",
    "status": "queued | processing | done | failed",
    "documentId": "uuid",
    "error": null,
    "queuePosition": 2,
    "progress": { "done": 10, "total": 25 },
    "createdAt": "...", "startedAt": null, "finishedAt": null
}
```

`queuePosition` is 1 for "you're next" and `null` once the job is not waiting.

## Uploading a document

The laptop never receives files: **the browser extracts the text** and sends JSON.

- PDF: [pdf.js](https://mozilla.github.io/pdf.js/). Word (.docx): mammoth's browser build. Plain text: read the file as text.
- A scanned PDF gives little or no text: warn the user before uploading (RAG1 asked "Continue? [y/N]"; here it becomes a dialog).
- `text`: up to **200,000 characters** (JavaScript's `length`; about 60 Word pages). Check it before sending and say so; the API answers 400 otherwise. The API cleans the text itself (control characters, extra spaces).
- `filename`: 1 to 255 characters, without control or text-direction characters (the API answers 400 "Filename contains control or text-direction characters").
- Limits per user: **3 documents** at a time (409, delete one first); **3 uploads per day**, deleted documents included (429); **one document indexing at a time** (409); 5 upload requests per minute (429). The whole queue holds 20 documents (503).
- After a 202, follow the indexing (next section). Show `expiresAt`: the document disappears 24 hours after its upload.

## Following the indexing

A document goes `pending` → `indexing` → `ready` (or `failed`, with the reason in the job's `error`). Only a `ready` document can be asked about.

### The live stream (preferred)

`GET /v1/events` keeps the connection open and pushes the user's own events as Server-Sent Events. **The browser's `EventSource` cannot send the `Authorization` header**, so read it with `fetch()` and parse it yourself, or use a small library such as `@microsoft/fetch-event-source`.

Each message is an `event:` line, a `data:` line with JSON, and a blank line. Lines that start with `:` are comments: `: connected` at the start and `: heartbeat` every 25 seconds.

```
event: progress
data: {"jobId":"...","done":10,"total":25}
```

| Event | Data | Meaning |
|---|---|---|
| `queued` | `jobId`, `position` | The document waits to be indexed; sent on upload and every time the line moves |
| `started` | `jobId` | Indexing started |
| `progress` | `jobId`, `done`, `total` | After every 10 chunks |
| `done` | `jobId`, `documentId` | The document is `ready` |
| `failed` | `jobId`, `error` | Indexing failed; `error` is safe to show |
| `question_queued` | `position` | The user's question waits for the model |
| `question_started` | (empty) | The model is answering the user's question |

Rules:

- **Open the stream only while something is pending** (a document indexing or a question waiting) and close it afterwards (`AbortController`). Close it on logout too.
- At most 2 streams per user and 4 per address (429), 30 in total (503). The server ends a stream when its token expires.
- The database is the source of truth: on page load or after a reconnect, read `GET /jobs/:id` (and `GET /documents`), then listen. A missed event does not matter.
- Ignore a `queued` that arrives after `started` for the same job (two messages sent at almost the same moment can arrive in that order).
- If the stream cannot be opened, poll `GET /jobs/:id` every 2 to 3 seconds instead.

## Asking a question

```
POST /v1/documents/:id/ask
{ "question": "When does the garden open?", "mode": "structured", "language": "en" }
```

- `question`: 1 to 1,000 characters.
- `mode`: `baseline` (default) or `structured`. Describe them next to the selector: **structured** abstains more often and invents less (18 of 20 correct abstentions in the evaluation, and faster); **baseline** answers more questions (60 of 80 against 54 of 80).
- `language`: `en` (default) or `es`, the language of the answer. Ask in the document's language: a Spanish question about an English document usually finds nothing.

The answer comes **in the same response**, usually within a second, at most 60 seconds:

```json
{
    "status": "answered",
    "answer": "The garden opens at 8:30 on Saturdays [F1].",
    "citations": ["F1"],
    "sources": [
        { "id": "F1", "chunkNumber": 1, "text": "The garden opens at 8:30 ...", "retrieval": "match", "score": 0.69 }
    ],
    "timings": { "waitMs": 1, "embeddingMs": 250, "retrievalMs": 12, "answerMs": 745, "totalMs": 1017 }
}
```

- `status`: `answered`; `insufficient_evidence` (the model said the document does not answer it; `answer` is a fixed sentence); or `no_match` (nothing in the document was close to the question; the model was not asked).
- `[F1]`, `[F2]` in the answer refer to `sources` by `id`. Make them clickable or highlighted to show the passage. `citations` lists the ids that really exist; an invented id may stay in a baseline answer's text but not in `citations`.
- `sources` are every passage the model saw: `retrieval: "match"` (with a similarity `score`) or `"neighbor"` (the text around a match).
- While waiting, the stream sends `question_queued` with a position ("2 questions before yours") and then `question_started` ("thinking").
- Limits: **one question at a time per user** (409 "You already have a question waiting for an answer"), 10 per minute and **30 per day** (429; `usage.questionsToday` in `GET /users/me`). A question that gets no answer (503, 504, or the user leaving) does not count.
- Errors: 404 (not the user's document), 409 (document not ready), 503 "The server is busy, please try again in a few minutes" or "The model server is not available", 504 "The model server did not answer in time".

## When the laptop is off

Requests then fail with a network error or an error page from Cloudflare, not with the API's JSON. Check `GET /v1/health` when the app opens and after such a failure, and show the state plainly:

- `ok`: everything works.
- `degraded`: the API answers but the models do not: documents and accounts can be browsed, but nothing can be indexed or answered.
- `down`, or no answer at all: the server is offline; try again later.

The health check is limited to 30 calls per minute per address and reuses its result for 10 seconds: never poll it faster than every few seconds.

## Security rules for the frontend

- **Render every text that comes from the server or the user as text, never as HTML** (`textContent`, or the framework's default escaping; no `innerHTML`): answers, sources, filenames, error `details`. Documents can contain anything, including markup.
- Keep the token in memory or `sessionStorage`, send it only in the `Authorization` header, and clear it on logout or on a 401. No cookies are needed.
- On the sign-up page, tell users not to upload sensitive files and that documents are deleted after 24 hours.

## Before publishing

- Connect the Cloudflare Pages project to `rag.diegodebrun.com`.
- When Turnstile is added: the site key goes in the frontend, the secret key in the API's `.env`.
