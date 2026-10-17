---
name: layered-express-structure
description: Folder layout, file naming, TypeScript setup and wiring of an Express API. Use when creating a new Express project, adding a new resource/entity end to end (route + controller + service + validator), creating or moving any file, or editing app.ts, server.ts, v1.routes.ts, tsconfig.json or package.json scripts.
---

# Express project structure

## 1. Location & naming

```
.
├── package.json                # "type": "module", scripts below
├── tsconfig.json               # compiles src/ → dist/
├── tsconfig.test.json          # type-checks src/ and test/ together, no output
├── .env.example                # every variable the app reads, with placeholder values
├── docker-compose.yml          # local PostgreSQL, when the project uses one
├── api/index.ts                # optional: Vercel entry, `export default app`
├── migrations/                 # NNN_<description>.sql, applied in order by src/migrate.ts
├── src/
│   ├── app.ts                  # builds the Express app (no listen)
│   ├── server.ts               # imports app and calls listen
│   ├── migrate.ts              # applies pending migrations (npm run migrate)
│   └── v1/
│       ├── v1.routes.ts        # mounts every router of the version
│       ├── config/             # external clients / connections   <name>.config.ts
│       ├── routes/             # <entities>.routes.ts
│       ├── controllers/        # <entities>.controller.ts
│       ├── services/           # <entities>.service.ts
│       ├── validators/         # <entities>.validator.ts
│       ├── middlewares/        # <name>.middleware.ts
│       ├── types/              # <entities>.type.ts + express.d.ts
│       └── utils/              # <name>.util.ts
├── test/
│   ├── setup.ts                # runs before every test file: points DATABASE_URL at the test database
│   ├── db/                     # schema and migration tests
│   └── <layer>/                # mirrors src/v1 (utils/, services/, ...): <name>.test.ts
├── docs/                       # project-guide.md: architecture and design decisions
└── dist/                       # build output, git-ignored, never edited
```

- File names: `<name>.<layer>.ts`. The entity is **plural**, the layer suffix is **singular** (`routes` is the one exception, since it is already plural). Multi-word names are camelCase: `watchlistItems.service.ts`, `validateBody.middleware.ts`, `appError.util.ts`. The only file outside this pattern is `types/express.d.ts`.
- One entity = one file per layer. Do not mix entities in a file.
- Folder names are plural and fixed. Do not create new top-level layers without asking.
- Paths in the other skills (`v1/controllers/...`) are relative to `src/`.

## 2. Responsibilities

Request flow, one direction only:

```
v1.routes.ts → <entities>.routes.ts → middlewares → <entities>.controller.ts → <entities>.service.ts → data layer
                                                                    errors ──► next(error) ──► errorMiddleware
```

| Layer | Does | Never |
|---|---|---|
| routes | map method + path → middlewares → controller | contain logic |
| middlewares | auth, authorization, validation, cross-cutting | contain business rules |
| controller | read `req`, call one service, send success response | touch the data layer, contain business rules |
| service | business rules, data access, throw `AppError` | touch `req`/`res` |
| validator | Joi schemas for request bodies + the matching input types | perform DB checks |
| types | entity/row shapes, the JWT payload, the `Request` augmentation | contain runtime code |
| utils | small reusable pure helpers | import from controllers/services |

## 3. Templates

- [templates/tsconfig.json](templates/tsconfig.json)
- [templates/app.ts](templates/app.ts)
- [templates/server.ts](templates/server.ts)
- [templates/v1.routes.ts](templates/v1.routes.ts)
- [templates/appError.util.ts](templates/appError.util.ts)
- [templates/express.d.ts](templates/express.d.ts) — adds `req.decoded` and `req.validatedBody` to Express's `Request`
- [templates/auth.type.ts](templates/auth.type.ts) — `TokenPayload`, the shape of `req.decoded`
- [templates/products.type.ts](templates/products.type.ts) — example entity type
- [templates/db.config.ts](templates/db.config.ts) — PostgreSQL `pool` and `withTransaction`
- [templates/migrate.ts](templates/migrate.ts) — migration runner
- [templates/setup.ts](templates/setup.ts) — `test/setup.ts`, points the tests at the test database

## 4. Rules

### TypeScript setup

- Copy `tsconfig.json` as is: `module`/`moduleResolution` `NodeNext`, `strict`, `verbatimModuleSyntax`, `rootDir: "src"`, `outDir: "dist"`.
- Relative imports use the **`.js`** extension even though the files are `.ts` (`import { app } from "./app.js"`). `NodeNext` requires it and it is what runs from `dist/`. Never write `.ts` in an import.
- Type-only imports use `import type { ... }` (enforced by `verbatimModuleSyntax`).
- No `any`. Use `unknown` and narrow it, or a precise type. A cast (`as X`) is allowed only where a value crosses an untyped boundary: `req.validatedBody`, `jwt.verify`, rows returned by the data layer.
- Dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/express`, plus `@types/<pkg>` for every runtime package that ships no types (`@types/cors`, `@types/jsonwebtoken`, ...).
- `package.json` scripts (`migrate` only when the project has a database):

  ```json
  "scripts": {
      "dev": "tsx watch src/server.ts",
      "build": "tsc",
      "start": "node dist/server.js",
      "migrate": "tsx src/migrate.ts",
      "typecheck": "tsc -p tsconfig.test.json",
      "test": "node --import tsx --import ./test/setup.ts --test --test-concurrency=1 \"test/**/*.test.ts\""
  }
  ```

### Database (PostgreSQL with `pg`)

- `config/db.config.ts` exports `pool` (one `pg.Pool` for the whole process, built from `DATABASE_URL`; startup fails if it is missing) and `withTransaction(callback)`. Copy the template.
- The schema changes only through migrations: `migrations/NNN_<description>.sql`, with a three-digit prefix (files are applied in alphabetical order) and one logical change per file. Never edit a migration that has been applied or merged; add a new one.
- `src/migrate.ts` applies the pending files, each together with its `schema_migrations` record in one transaction, under an advisory lock. Copy the template.
- Ids exposed in URLs are UUIDs generated by the database: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`. Tables that never appear in URLs may use `bigint GENERATED ALWAYS AS IDENTITY` or a natural key.
- Column names are snake_case. Fixed value lists are `text` with a `CHECK (... IN (...))` constraint, not `ENUM` types.
- Index every foreign key column; PostgreSQL does not create those indexes automatically.
- Secrets live in `.env` (git-ignored); `.env.example` lists every variable with placeholder values.

### Tests

- `node:test` and `node:assert/strict`, run with `tsx`; files are `test/<layer>/<name>.test.ts`, mirroring `src/v1`.
- Database tests use their own database, whose name ends in `_test`, through `TEST_DATABASE_URL`. `test/setup.ts` replaces `DATABASE_URL` with it before any test file loads, and removes `DATABASE_URL` when it is missing so tests can never reach the development database.
- A database test file resets the schema and runs the real migration script in `before`, empties the tables in `beforeEach`, and closes the pool in `after`. Test files run one at a time (`--test-concurrency=1`) because they share the test database.

### Types

- Entity/row shapes live in `types/<entities>.type.ts` as `export interface <Entity>` (e.g. `Product`). Services return these types.
- Request-body input types (`Create<Entity>Input`, `Update<Entity>Input`) live in the validator file next to their schema (see `layered-express-validator`).
- New `req.*` properties are declared in `types/express.d.ts` and documented in the `layered-express-middleware` skill.

### Wiring

- `app.ts` order: `import "dotenv/config"` first → `cors` → `express.json()` → `express.urlencoded({ extended: true })` → `app.use("/v1", v1Router)` → `notFoundMiddleware` → `errorMiddleware` (always last).
- `app.ts` exports `app`; only `server.ts` calls `listen`, so the app can be reused by Vercel and tests.
- Database connection setup lives in `config/db.config.ts`.
- Every new project starts with: `tsconfig.json`, `utils/appError.util.ts`, `types/express.d.ts`, `types/auth.type.ts`, plus the core middlewares from the `layered-express-middleware` skill (`error`, `notFound`, `validateBody`, `authenticate`, `authorize`).
- **Adding a new resource** — create files in this order, loading each layer's skill:
  0. `migrations/NNN_<description>.sql` when the resource needs new tables or columns
  1. `types/<entities>.type.ts` (entity shape)
  2. `validators/<entities>.validator.ts` → `layered-express-validator`
  3. `services/<entities>.service.ts` → `layered-express-service`
  4. `controllers/<entities>.controller.ts` → `layered-express-controller`
  5. `routes/<entities>.routes.ts` → `layered-express-route`
  6. Mount the router in `v1/v1.routes.ts` (public or protected section).

## 5. Checklist

- [ ] Every file sits in its layer folder under `src/` and follows `<name>.<layer>.ts`.
- [ ] Relative imports end in `.js`; type-only imports use `import type`.
- [ ] No layer is skipped (routes never call services; controllers never touch the data layer).
- [ ] New router is mounted in `v1.routes.ts` in the correct section.
- [ ] `errorMiddleware` is the last `app.use`.
- [ ] `npm run build` and `npm run typecheck` pass with no type errors.
- [ ] Schema changes are in a new migration; no applied migration was edited.
