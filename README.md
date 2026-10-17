# RAG-WebApi

Self-hosted RAG API: upload a document, ask questions about it, get answers that cite the passages they come from. Built with Express and TypeScript, PostgreSQL with pgvector, Docker, and local Ollama models, so it runs for free on one laptop.

> **Status:** work in progress. The domain logic and the database layer are done and tested; the HTTP endpoints (auth, documents, questions) are next. See [docs/project-guide.md](docs/project-guide.md) for how everything works and why it was built this way.

It turns the command-line app from [RAG-learning](https://github.com/Diegodebece/RAG-learning) (RAG1) into a web service, reusing its retrieval and answer pipelines and the settings measured in its evaluation.

## How it works

1. **Indexing:** the browser extracts the text of a file and sends it as JSON. The API cleans it, splits it into chunks of up to 1,000 characters, and stores one embedding per chunk (`qwen3-embedding:0.6b`).
2. **Asking:** the question is embedded, PostgreSQL returns the 3 most similar chunks of the document plus their neighbors, and `qwen3.5:4b` answers using only those chunks, citing them as `[F1]`, `[F2]`, ...

## Requirements

- Node.js 22.18 or later
- Docker Desktop (runs PostgreSQL 17 with pgvector)
- Ollama with `qwen3.5:4b` and `qwen3-embedding:0.6b` (needed once the question endpoints exist)

## Setup

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from the example and replace every `change-me` with the same long random password (letters and digits only, so it works inside the URLs). This prints one:

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

## Scripts

| Script | What it does |
|---|---|
| `npm run migrate` | Applies the pending SQL files in `migrations/` to `DATABASE_URL` |
| `npm test` | Runs all tests; the database tests use `TEST_DATABASE_URL` and need the container running |
| `npm run typecheck` | Type-checks the source and the tests |
| `npm run build` | Compiles `src/` to `dist/` |

## Project structure

```
src/
├── migrate.ts            migration runner (npm run migrate)
└── v1/
    ├── config/           database pool, RAG constants
    ├── types/            shared TypeScript types
    └── utils/            pure RAG logic: cleaning, chunking, prompts, answer checks
migrations/               numbered SQL files, applied in order
test/
├── setup.ts              points the tests at the test database
├── db/                   schema and migration tests (PostgreSQL)
└── utils/                unit tests for the RAG logic
docs/
└── project-guide.md      architecture, layer by layer, and every design decision
```

Routes, controllers, services, validators and middlewares will appear under `src/v1/` as the HTTP layers are built.
