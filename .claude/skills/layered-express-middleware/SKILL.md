---
name: layered-express-middleware
description: How to write Express middlewares, including the core set every project has (error, notFound, validateBody, authenticate, authorize). Use when creating or editing any v1/middlewares/*.middleware.ts file, or setting up error handling, auth or validation in a new project.
---

# Express middlewares

## 1. Location & naming

- File: `v1/middlewares/<name>.middleware.ts`, camelCase name (`validateBody.middleware.ts`).
- Export: `export const <name>Middleware` (e.g. `authorizeMiddleware`).

## 2. Responsibilities

- Does: cross-cutting concerns that run before controllers — authentication, authorization, validation, file parsing, rate limiting; plus the final `notFound` and `error` handlers.
- Never: business rules or data access specific to one resource (that's a service).

## 3. Templates

Core set, copy into every new project:

- [templates/error.middleware.ts](templates/error.middleware.ts) — the only place that writes error responses
- [templates/notFound.middleware.ts](templates/notFound.middleware.ts)
- [templates/validateBody.middleware.ts](templates/validateBody.middleware.ts)
- [templates/authenticate.middleware.ts](templates/authenticate.middleware.ts)
- [templates/authorize.middleware.ts](templates/authorize.middleware.ts)

When the project needs request limits:

- [templates/rateLimit.middleware.ts](templates/rateLimit.middleware.ts) — `rateLimitMiddleware({ limit, windowMs, keyBy, onlyFailures })` on top of `express-rate-limit`

## 4. Rules

- Plain middleware: `export const xMiddleware = (req: Request, res: Response, next: NextFunction) => { ... };`, with `import type { Request, Response, NextFunction } from "express";`.
- Configurable middleware is a factory with typed options: `export const xMiddleware = (options: XOptions) => (req: Request, res: Response, next: NextFunction) => { ... };` (e.g. `authorizeMiddleware(["admin"])` takes `roles: string[]`, `validateBodyMiddleware(schema)` takes a Joi `ObjectSchema`).
- Middlewares **never** send error responses themselves: they call `next(new AppError(status, message))`. Only `errorMiddleware` writes error bodies, so every error has the shape `{ message }` (+ `details` for validation).
- On success, either attach data to `req` and call `next()`, or just call `next()`. Agreed `req` properties, declared in `types/express.d.ts`:
  - `req.decoded?: TokenPayload` — JWT payload set by `authenticateMiddleware` (`id`, `role`, ...). `TokenPayload` lives in `types/auth.type.ts`; extend it there when the token carries more fields.
  - `req.validatedBody?: unknown` — Joi output set by `validateBodyMiddleware`. Controllers cast it to the validator's input type.
  - Introduce new `req.*` properties only with a clear English name, declare them in `types/express.d.ts`, and document them here.
- Async middlewares wrap their body in `try/catch → next(error)`, same as controllers.
- `errorMiddleware` keeps the 4-argument signature `(err: unknown, req: Request, res: Response, next: NextFunction)`, is registered last, logs unexpected errors and never leaks their message (generic 500). It narrows `err` with `instanceof AppError` or a type guard, never with `any`.
- Required config read from `process.env` (e.g. `SECRET_KEY`) is checked before use; if it is missing, call `next(new Error("<NAME> is not set"))` so `errorMiddleware` answers 500. Do not cast it with `as string`.
- `validateBodyMiddleware` validates `req.body ?? {}`: Express 5 leaves `req.body` undefined for a request without a body, and Joi accepts undefined for an object schema.
- `authenticateMiddleware` verifies tokens with a pinned algorithm (`{ algorithms: ["HS256"] }`), so tokens signed any other way, including `alg: none`, are rejected.
- Rate limits: build each limit with `rateLimitMiddleware({ ... })` in the router, with values read from a config module (never hardcoded). Its handler calls `next(new AppError(429, ...))`, so a 429 has the usual error body. Email-keyed limits read the raw body and must run after `express.json()`. `onlyFailures` counts only error responses (failed logins); `onlySuccesses` counts only successful ones (accounts created), so typos do not use up a limit.

## 5. Checklist

- [ ] Named `<name>Middleware`, factory form when it takes options.
- [ ] Errors go through `next(new AppError(...))`, never `res.status(4xx).json(...)`.
- [ ] Data passed downstream only via `req.decoded`, `req.validatedBody` or a property declared in `types/express.d.ts` and documented here.
- [ ] Parameters typed with Express's `Request`, `Response`, `NextFunction`.
