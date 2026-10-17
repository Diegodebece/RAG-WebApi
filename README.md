# RAG-WebApi

Self-hosted RAG API: upload a document, ask questions about it, get answers that cite the passages they come from. Built with Express and TypeScript, PostgreSQL with pgvector, Docker, and local Ollama models, so it runs for free on one laptop.

> **Status:** work in progress. Accounts, the health check and documents work: uploads are indexed in the background with Ollama, with progress you can poll. Asking questions is next. See [docs/project-guide.md](docs/project-guide.md) for how everything works and why it was built this way.

It turns the command-line app from [RAG-learning](https://github.com/Diegodebece/RAG-learning) (RAG1) into a web service, reusing its retrieval and answer pipelines and the settings measured in its evaluation.

## How it works

1. **Indexing:** the browser extracts the text of a file and sends it as JSON. The API cleans it, splits it into chunks of up to 1,000 characters, and stores one embedding per chunk (`qwen3-embedding:0.6b`).
2. **Asking:** the question is embedded, PostgreSQL returns the 3 most similar chunks of the document plus their neighbors, and `qwen3.5:4b` answers using only those chunks, citing them as `[F1]`, `[F2]`, ...

## Requirements

- Node.js 22.18 or later
- Docker Desktop (runs PostgreSQL 17 with pgvector)
- Ollama with `qwen3.5:4b` and `qwen3-embedding:0.6b`

## Setup

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from `.env.example`. Replace every `change-me` in the database lines with the same long random password (letters and digits only, so it works inside the URLs), and `SECRET_KEY` with a different one. This prints a random value:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

3. Start PostgreSQL. It listens on `127.0.0.1:5432` only, and its data lives in a Docker volume:

   ```bash
   docker compose up -d
   ```

4. Create the test database, once (the tests empty it on every run):

   ```bash
   docker compose exec db createdb -U rag rag_test
   ```

5. Create the tables:

   ```bash
   npm run migrate
   ```

6. Start the API on `http://127.0.0.1:3000`, restarting on every change:

   ```bash
   npm run dev
   ```

## Endpoints

All paths start with `/v1`. Protected endpoints need the header `Authorization: Bearer <token>`.

| Method and path | Access | What it does |
|---|---|---|
| `GET /health` | Public | `status` is `ok`, `degraded` (Ollama down) or `down` (database down) |
| `POST /auth/register` | Public | Creates an account from `{ email, password }` and returns it with a token |
| `POST /auth/login` | Public | Returns the account and a token valid for 1 hour |
| `GET /users/me` | Protected | Returns the account of the token's owner and its usage: documents stored, and uploads and questions in the last 24 hours, each with its limit |
| `POST /documents` | Protected | Stores `{ filename, text }` (up to 200,000 characters) and queues its indexing; answers `202` with the document and a `jobId`. Each user can keep 3 documents and upload 3 per day (`429` after that, deleted documents included) |
| `GET /documents` | Protected | Lists your documents, newest first |
| `GET /documents/:id` | Protected | Returns one of your documents |
| `DELETE /documents/:id` | Protected | Deletes one of your documents |
| `POST /documents/:id/ask` | Protected | Answers `{ question, mode?, language? }` about one of your ready documents with `{ status, answer, citations, sources, timings }`. `mode` is `baseline` (default) or `structured`, `language` `en` (default) or `es`. 10 questions per minute and 30 per day; the answer comes in the response, after waiting at most 60 seconds for the model |
| `GET /jobs/:id` | Protected | Returns a job's status, its position in the queue and its progress (chunks embedded out of the total) |
| `GET /events` | Protected | A stream of your live events (Server-Sent Events): your documents' place in the indexing queue and their progress, and your question's place in line while it waits for the model. Read it with `fetch()` and the `Authorization` header; at most 2 streams per user, and a stream ends when its token expires |

Successful responses look like `{ success: true, message, data }`; errors look like `{ message }`, with `details` for validation errors.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Runs the API from the TypeScript sources, restarting on changes |
| `npm run build` | Compiles `src/` to `dist/` |
| `npm start` | Runs the compiled API from `dist/` |
| `npm run migrate` | Applies the pending SQL files in `migrations/` to `DATABASE_URL` |
| `npm test` | Runs all tests; the database tests use `TEST_DATABASE_URL` and need the container running |
| `npm run typecheck` | Type-checks the source and the tests |

## Project structure

```
src/
├── app.ts                builds the Express app
├── server.ts             starts it (npm run dev / npm start)
├── migrate.ts            migration runner (npm run migrate)
└── v1/
    ├── v1.routes.ts      mounts the public and protected routes
    ├── routes/           paths and their middlewares
    ├── controllers/      read the request, call one service, send the response
    ├── services/         business rules and SQL
    ├── validators/       Joi schemas for request bodies
    ├── middlewares/      errors, validation, authentication, rate limits, security headers
    ├── config/           database pool, limits, Ollama, RAG constants
    ├── types/            shared TypeScript types
    └── utils/            pure helpers: RAG logic, passwords, tokens, errors
migrations/               numbered SQL files, applied in order
test/
├── setup.ts              points the tests at the test database
├── db/                   schema and migration tests
├── middlewares/          middleware tests
├── routes/               endpoint tests against the real app
├── services/             queue and cleanup tests, with a fake Ollama
└── utils/                unit tests
docs/
└── project-guide.md      architecture, layer by layer, and every design decision
```
