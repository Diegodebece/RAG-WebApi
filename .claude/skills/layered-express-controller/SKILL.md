---
name: layered-express-controller
description: How to write Express controllers. Use when creating or editing any v1/controllers/*.controller.ts file or adding a handler for an endpoint.
---

# Express controllers

## 1. Location & naming

- File: `v1/controllers/<entities>.controller.ts` (e.g. `products.controller.ts`).
- Functions: `get<Entities>`, `get<Entity>ById`, `create<Entity>`, `update<Entity>`, `delete<Entity>`; custom actions are `<verb><Entity>` (e.g. `changeUserRole`).
- Each controller calls the service of the same name with a `Service` suffix (`createProduct` → `createProductService`).

## 2. Responsibilities

- Does: extract inputs from `req`, call **one** service, send the success response.
- Never: business rules, data access, building error responses, or `res.status(4xx/5xx)`.

## 3. Template

[templates/products.controller.ts](templates/products.controller.ts)

[templates/requireUserId.util.ts](templates/requireUserId.util.ts) — goes in `utils/`

## 4. Rules

- Signature is always `export const name = async (req: Request, res: Response, next: NextFunction) => { ... };`, with `import type { Request, Response, NextFunction } from "express";`. Let TypeScript infer the return type.
- The whole body is wrapped in `try { ... } catch (error) { next(error); }`. No exceptions, even for one-liners.
- Inputs come only from:
  - `req.params` (ids are UUID strings: `const { id } = req.params;`, passed as they are). A handler that reads params declares them in its signature, `req: Request<{ id: string }>`; with a plain `Request`, Express 5 types each param as `string | string[]`. `req.query` (`page`, `limit`, filters),
  - `req.validatedBody` (**never** `req.body`), cast to the input type exported by the validator: `req.validatedBody as CreateProductInput`,
  - `req.decoded` (logged-in user: `id`, `role`, ...), read through `requireUserId(req)` from `utils/requireUserId.util.ts`. Never `req.decoded!.id`: if a router is ever mounted without `authenticateMiddleware`, `requireUserId` throws a 401 `AppError` (forwarded by the `catch`) instead of crashing into a 500.
- When the service can take long (it waits for a shared resource or an external model), the controller creates an `AbortController`, aborts it from `res.on("close")` when `!res.writableFinished` (the client left before the response), and passes `signal` as the service's last argument. The service then stops the work nobody will receive.
- Pass plain values to the service, never `req` or `res`. When ownership matters, pass the user id as the first argument: `createWatchlistItemService(requireUserId(req), req.validatedBody as CreateWatchlistItemInput)`.
- Always `return res.status(<code>).json({ success: true, message, data })`:
  - 200 for get/update/delete, 201 for create.
  - `message` is a short English sentence: "Product created successfully".
  - `delete` responds without `data`.
  - Extra top-level fields (e.g. `token`) only when the client needs them outside `data`.
- An empty list is a success: `200` with `data: []`. Never 404 for an empty list.
- Errors: let the service throw `AppError`; the `catch` forwards it. A controller never creates errors itself.
- Even trivial endpoints go through a service.

## 5. Checklist

- [ ] `async (req: Request, res: Response, next: NextFunction)` + full `try/catch → next(error)`.
- [ ] Reads `req.validatedBody` cast to the validator's input type, not `req.body`.
- [ ] Calls exactly one service.
- [ ] Responds with `return res.status(...).json({ success: true, message, data })`.
