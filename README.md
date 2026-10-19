# RAG-WebApi

Self-hosted RAG API: upload a document, ask questions about it, get answers that cite the passages they come from. Built with Express and TypeScript, PostgreSQL with pgvector, Docker, and local Ollama models, so it runs for free on one laptop.

## About this project

This project has two goals for me. The first is to learn to work with Claude Code and its tools: directing the development and auditing the result instead of writing every line myself. The second is to learn, along the way, how Docker, Cloudflare and the other technologies used here work.

I built it with Claude Code's skills, subagents and hooks. The skills describe the layered architecture of earlier projects I wrote on my own or with classmates at university, and I tried to reproduce that architecture here, discussing with Claude how each part should work before any code was written. Then independent agents, with no prior context about the project, audited it to find bugs and vulnerabilities.

> **Status:** the API is complete and deployed: accounts, documents indexed in the background, questions with cited answers, live events, and a Docker setup published through a Cloudflare Tunnel. The frontend is next. See [docs/project-guide.md](docs/project-guide.md) for how everything works and why it was built this way.

It turns the command-line app from [RAG-learning](https://github.com/Diegodebece/RAG-learning) (RAG1) into a web service, reusing its retrieval and answer pipelines and the settings measured in its evaluation.

## How it works

1. **Indexing:** the browser extracts the text of a file and sends it as JSON. The API cleans it, splits it into chunks of up to 1,000 characters, and stores one embedding per chunk (`qwen3-embedding:0.6b`).
2. **Asking:** the question is embedded, PostgreSQL returns the 3 most similar chunks of the document plus their neighbors, and `qwen3.5:4b` answers using only those chunks, citing them as `[F1]`, `[F2]`, ...

## Requirements

- Node.js 22.18 or later
- Docker Desktop (runs PostgreSQL 17 with pgvector; in deployment, the API and the tunnel too)
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
   docker compose up -d db
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

## Deployment with Docker

In deployment the API runs in Docker next to PostgreSQL, and a Cloudflare Tunnel publishes it on a subdomain without opening any port. Ollama keeps running on the host. The guide's [Deployment](docs/project-guide.md#14-deployment) section explains every choice.

1. In `.env`, besides the values from the setup above, set `APP_DB_PASSWORD` (another random value) and `CLOUDFLARE_TUNNEL_TOKEN`. To get the token, create a tunnel in the Cloudflare dashboard (Networking, Tunnels), choose Docker, and copy only what follows `--token` in the command it shows. Then add a published application route from your subdomain to `http://api:3000`. In `docker-compose.yml`, set `CORS_ORIGINS` to your frontend's address: settings that are not secrets go there, because the container only receives the variables the compose lists.

2. Start the database and create the API's database user, which can only read and change rows:

   ```bash
   docker compose up -d db
   ```

   ```bash
   Get-Content scripts\create-app-role.sql | docker compose exec -T db psql -U rag -d rag -v ON_ERROR_STOP=1
   ```

   (in bash: `docker compose exec -T db psql -U rag -d rag -v ON_ERROR_STOP=1 < scripts/create-app-role.sql`)

3. Set its password to the value of `APP_DB_PASSWORD`: open `psql` with `docker compose exec db psql -U rag -d rag`, run `\password rag_app`, then `\q`.

4. Build the image, apply the migrations as the owner, and start everything:

   ```bash
   docker compose build api
   ```

   ```bash
   docker compose run --rm migrate
   ```

   ```bash
   docker compose up -d
   ```

5. Check it: `docker compose logs api` should show "Models loaded", `docker compose logs cloudflared` four "Registered tunnel connection" lines, and `https://<your subdomain>/v1/health` a status of `ok`.

After changing the code: `docker compose build api`, `docker compose run --rm migrate`, `docker compose up -d api`.

## Endpoints

All paths start with `/v1`. Protected endpoints need the header `Authorization: Bearer <token>`, and each user can make 120 requests per minute to them, on top of each endpoint's own limits.

| Method and path | Access | What it does |
|---|---|---|
| `GET /health` | Public | `status` is `ok`, `degraded` (Ollama down) or `down` (database down) |
| `POST /auth/register` | Public | Creates an account from `{ email, password }` and returns it with a token |
| `POST /auth/login` | Public | Returns the account and a token valid for 1 hour |
| `GET /users/me` | Protected | Returns the account of the token's owner and its usage: documents stored, and uploads and questions in the last 24 hours, each with its limit |
| `POST /documents` | Protected | Stores `{ filename, text }` (up to 200,000 characters) and queues its indexing; answers `202` with the document and a `jobId`. Each user can keep 3 documents and upload 3 per day (`429` after that, deleted documents included), with at most 5 upload requests per minute |
| `GET /documents` | Protected | Lists your documents, newest first |
| `GET /documents/:id` | Protected | Returns one of your documents |
| `DELETE /documents/:id` | Protected | Deletes one of your documents |
| `POST /documents/:id/ask` | Protected | Answers `{ question, mode?, language? }` about one of your ready documents with `{ status, answer, citations, sources, timings }`. `mode` is `baseline` (default) or `structured`, `language` `en` (default) or `es`. 10 questions per minute and 30 per day; the answer comes in the response, within 60 seconds in total, and a question that gets no answer does not count, unless you leave while the model is answering |
| `GET /jobs/:id` | Protected | Returns a job's status, its position in the queue and its progress (chunks embedded out of the total) |
| `GET /events` | Protected | A stream of your live events (Server-Sent Events): your documents' place in the indexing queue and their progress, and your question's place in line while it waits for the model. Read it with `fetch()` and the `Authorization` header; at most 2 streams per user and 4 per address, and a stream ends when its token expires |

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
├── server.ts             starts it (npm run dev / npm start) and shuts it down gracefully
├── shutdown.ts           closes the server without cutting requests in progress
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
scripts/                  one-off database setup (the API's database user)
Dockerfile                the API's image, built in two stages
docker-compose.yml        db, api, cloudflared, and migrate on demand
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
