# Node.js / Express standards (layered-express)

## Stack
- Node.js with ES modules (`"type": "module"`), TypeScript (`strict`, `NodeNext`), Express 5, Joi for validation, JWT for auth.
- Source lives in `src/` as `.ts` files and compiles to `dist/` with `tsc`; `tsx` runs the sources in development.
- Data layer: not defined yet (next projects use SQL). Follow whatever the project already uses.

## Global rules
- Everything in English: identifiers, file names, routes, response and error messages.
- 4-space indentation, double quotes, semicolons.
- Named exports only. The single exception is a platform entry point that requires a default export (e.g. `api/index.ts` for Vercel).
- Functions are `export const name = async (...) => { ... };` arrow functions. Classes only where needed (e.g. `AppError`).
- Always `async/await`, never callbacks or `.then()` chains.
- Relative imports always use the `.js` extension, even in `.ts` files (`import { app } from "./app.js"`). Never import with `.ts`.
- Type-only imports use `import type { ... }`.
- No `any`: use precise types, or `unknown` plus narrowing. Casts (`as X`) only at untyped boundaries (`req.validatedBody`, `jwt.verify`, data-layer rows).
- Secrets and config come from `process.env` (loaded via `import "dotenv/config"`); never hardcode them.

## Errors and responses
- Throw `new AppError(status, message)` (from `utils/appError.util.ts`) for every expected error. Never throw a bare `Error` with a `.status` property.
- Success body: `{ success: true, message, data }`.
- Error body: `{ message }`, plus `details` for validation errors. Only `errorMiddleware` writes error responses.

## Workflows — always load the matching skill before writing code
- Creating a project, adding a new resource/entity, moving files, `tsconfig.json`, types → `layered-express-structure`
- Routers (`*.routes.ts`, `v1.routes.ts`) → `layered-express-route`
- Controllers (`*.controller.ts`) → `layered-express-controller`
- Services (`*.service.ts`) → `layered-express-service`
- Joi schemas and input types (`*.validator.ts`) → `layered-express-validator`
- Middlewares (`*.middleware.ts`) → `layered-express-middleware`
