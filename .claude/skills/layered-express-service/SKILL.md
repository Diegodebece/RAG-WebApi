---
name: layered-express-service
description: How to write the service (business logic) layer of an Express API. Use when creating or editing any v1/services/*.service.ts file, adding business rules, existence/uniqueness/ownership checks, or calling external APIs.
---

# Express services

## 1. Location & naming

- File: `v1/services/<entities>.service.ts` (e.g. `products.service.ts`).
- Functions: the controller name + `Service` suffix: `getProductsService`, `getProductByIdService`, `createProductService`, `updateProductService`, `deleteProductService`.
- Wrappers around external APIs get their own file named after the provider: `gemini.service.ts`, `tvmaze.service.ts`.

## 2. Responsibilities

- Does: business rules, existence/uniqueness/ownership checks, data access, calls to external APIs, shaping the returned data.
- Never: touch `req`, `res` or `next`; send responses; read `process.env` for request-specific data.

## 3. Template

- [templates/products.service.ts](templates/products.service.ts) — CRUD with PostgreSQL through `pg`
- [templates/dbErrors.util.ts](templates/dbErrors.util.ts) — `isUniqueViolation`, goes in `utils/`
- [templates/uuid.util.ts](templates/uuid.util.ts) — `isUuid`, goes in `utils/`

The template assumes PostgreSQL with `pg` and the `pool` / `withTransaction` from `config/db.config.ts` (see `layered-express-structure`). A project with another data layer keeps the same rules and swaps the queries.

## 4. Rules

- Signature: `export const name = async (...plainArgs): Promise<ReturnType> => { ... };`. Arguments are plain, typed values (`id: string`, `data: CreateProductInput`, `userId: string`, `page: unknown`, `limit: unknown`), never `req`. Ids are UUID strings.
- Always annotate the return type: the entity type from `types/<entities>.type.ts` (`Promise<Product>`, `Promise<Product[]>`), a purpose-built shape when you return a subset of fields, or `Promise<void>` when nothing is returned (e.g. delete).
- `data` arguments use the input types exported by the validator (`CreateProductInput`, `UpdateProductInput`), imported with `import type`.
- Argument order: `userId` (when ownership matters) → `id` → `data` → `page, limit`.
- Signal every expected failure with `throw new AppError(status, message)`:

  | Situation | Status |
  |---|---|
  | invalid input that passed Joi (business rule broken) | 400 |
  | role not allowed for this action | 403 |
  | resource not found, or it belongs to another user | 404 |
  | duplicate / state conflict (including a quota already used up) | 409 |
  | temporarily unavailable: a queue is full or a dependency is down | 503 |
  | a dependency did not answer in time | 504 |

  Messages are short English sentences: "Product not found".
- Never throw `Error` with a `.status`, never use status `200` in an `AppError`, and use `5xx` only for the 503/504 cases above: any other 5xx is an unexpected error that must bubble up to `errorMiddleware`'s generic 500. Do not catch errors just to rethrow them; let unexpected errors bubble up.
- `getById`, `update` and `delete` always 404 when the resource does not exist.
- `update` re-checks uniqueness only for the fields being changed, excluding the current record.
- Ids from the URL are checked with `isUuid(id)` (`utils/uuid.util.ts`) before querying; a malformed id gets the same 404 as an unknown one, instead of PostgreSQL's `22P02` error becoming a 500.
- Ownership: when a resource belongs to a user, receive `userId` and filter by it in the query itself (`WHERE id = $1 AND user_id = $2`). A resource of another user gets the same 404 as a missing one, so its existence is not revealed.
- Lists return an empty array when nothing is found, never an error.
- Pagination (inline for now): `page` and `limit` arrive as `unknown` straight from `req.query`; `const pageNumber = Number(page) || 1; const limitNumber = Number(limit) || 5; const offset = (pageNumber - 1) * limitNumber;`
- Never return secrets (password hashes, tokens of other users). Pick the fields to return explicitly, and make the return type exclude them (e.g. `Omit<User, "passwordHash">`).
- A service may call another service; it never imports a controller.

### Data access (PostgreSQL with `pg`)

- Query with `pool.query<Row>(sql, [values])`. Values always go as `$1, $2, ...` parameters, never inside the SQL text: no template literals with user data. Only fixed SQL fragments written in the code (like a column list) may be interpolated.
- List columns explicitly, never `SELECT *` or `RETURNING *`, and rename snake_case to camelCase in SQL: `category_id AS "categoryId"`. Keep the list in one constant per file, e.g. `PRODUCT_COLUMNS`, matching the entity type.
- Use `RETURNING <columns>` to get the created, updated or deleted row in the same query; an empty result means nothing matched, which is the 404 case.
- `pg` returns `bigint` (including `count(*)`) and `numeric` as strings. Cast in SQL (`count(*)::int`, `price::float8`) or convert with `Number(...)`.
- Several writes that must succeed or fail together go inside `withTransaction(async (client) => { ... })`, using `client.query`, not `pool.query`.
- Check uniqueness before inserting, and also translate the database's unique violation (`isUniqueViolation(error)`, code `23505`) into the same `AppError(409)`, since two requests can pass the check at the same time.
- Compare case-insensitive values (emails, names) as `lower(column) = lower($1)`, matching the unique index on `lower(column)`.

## 5. Checklist

- [ ] No `req`/`res`/`next` anywhere in the file.
- [ ] Every expected failure throws `AppError` with the right status.
- [ ] Not-found checks on get-by-id, update and delete.
- [ ] Ownership filtered in the query when the resource belongs to a user; another user's resource gets 404.
- [ ] Sensitive fields excluded from the result and from its type.
- [ ] Arguments and return type annotated; no `any`.
- [ ] Every value is a `$n` parameter; columns are listed explicitly and renamed to camelCase.
