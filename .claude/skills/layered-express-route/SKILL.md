---
name: layered-express-route
description: How to write Express routers. Use when creating or editing any v1/routes/*.routes.ts file, adding an endpoint, choosing HTTP methods/paths, or mounting a router in v1.routes.ts.
---

# Express routes

## 1. Location & naming

- File: `v1/routes/<entities>.routes.ts` (e.g. `products.routes.ts`).
- Export: `export const <entities>Router` (e.g. `productsRouter`).
- URL paths: plural, lowercase, kebab-case English nouns (`/products`, `/watchlist-items`). Mounted in `v1/v1.routes.ts`.

## 2. Responsibilities

- Does: map HTTP method + path → middlewares → one controller function.
- Never: inline handlers, business logic, `try/catch`, or direct service calls.

## 3. Template

[templates/products.routes.ts](templates/products.routes.ts)

## 4. Rules

- Create the router with `express.Router({ mergeParams: true })`.
- Standard CRUD mapping:

  | Method & path | Controller | Status |
  |---|---|---|
  | `GET /` | `get<Entities>` | 200 |
  | `GET /:id` | `get<Entity>ById` | 200 |
  | `POST /` | `create<Entity>` | 201 |
  | `PATCH /:id` | `update<Entity>` | 200 |
  | `DELETE /:id` | `delete<Entity>` | 200 |

  Use `PATCH` for updates, not `PUT`.
- Middleware order on a route is always: rate limits keyed by address → `authorizeMiddleware([...])` → `express.json()` → rate limits that read the body → `validateBodyMiddleware(schema)` → controller.
- There is no global body parser: every route that reads a body adds `express.json()` itself, right before the first middleware that reads `req.body`. Use `express.json({ limit: "2mb" })` (or what the route needs) only where the 100 KB default is too small. Requests rejected earlier (no token, no role, address over its limit) never get their body read.
- Every `POST` and `PATCH` with a body uses `express.json()` and `validateBodyMiddleware`: `create<Entity>Schema` for POST, `update<Entity>Schema` for PATCH.
- Authentication is applied once in `v1.routes.ts`. Do **not** add `authenticateMiddleware` again inside a router mounted in the protected section.
- Declare static paths (`/me`, `/trending`) **before** parameterized ones (`/:id`).
- Line order in the file: list, by id, create, update, delete, then custom actions.
- Custom actions are sub-resources/verbs under the item: `PATCH /:id/role`, `GET /me`.
- Mounting: add the import and `v1Router.use("/<entities>", <entities>Router)` in the public section (before `authenticateMiddleware`) only if the endpoints need no login; otherwise in the protected section.

## 5. Checklist

- [ ] Router exported as a named `<entities>Router`.
- [ ] Each route ends in exactly one controller function.
- [ ] Bodies on POST/PATCH are parsed by the route's own `express.json()` and validated with the right schema.
- [ ] Static paths come before `/:id`.
- [ ] Router mounted in `v1.routes.ts` in the correct section.
