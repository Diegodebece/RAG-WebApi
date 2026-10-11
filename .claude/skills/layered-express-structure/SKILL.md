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
├── api/index.ts                # optional: Vercel entry, `export default app`
├── src/
│   ├── app.ts                  # builds the Express app (no listen)
│   ├── server.ts               # imports app and calls listen
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

## 4. Rules

### TypeScript setup

- Copy `tsconfig.json` as is: `module`/`moduleResolution` `NodeNext`, `strict`, `verbatimModuleSyntax`, `rootDir: "src"`, `outDir: "dist"`.
- Relative imports use the **`.js`** extension even though the files are `.ts` (`import { app } from "./app.js"`). `NodeNext` requires it and it is what runs from `dist/`. Never write `.ts` in an import.
- Type-only imports use `import type { ... }` (enforced by `verbatimModuleSyntax`).
- No `any`. Use `unknown` and narrow it, or a precise type. A cast (`as X`) is allowed only where a value crosses an untyped boundary: `req.validatedBody`, `jwt.verify`, rows returned by the data layer.
- Dev dependencies: `typescript`, `tsx`, `@types/node`, `@types/express`, plus `@types/<pkg>` for every runtime package that ships no types (`@types/cors`, `@types/jsonwebtoken`, ...).
- `package.json` scripts:

  ```json
  "scripts": {
      "dev": "tsx watch src/server.ts",
      "build": "tsc",
      "start": "node dist/server.js"
  }
  ```

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
- [ ] `npm run build` passes with no type errors.
