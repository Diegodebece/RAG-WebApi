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

[templates/products.service.ts](templates/products.service.ts)

Lines marked `// DATA ACCESS` are placeholders: the data layer (SQL library, possible repository layer) is not defined yet. Use whatever the project already uses.

## 4. Rules

- Signature: `export const name = async (...plainArgs): Promise<ReturnType> => { ... };`. Arguments are plain, typed values (`id: number`, `data: CreateProductInput`, `userId: number`, `page: unknown`, `limit: unknown`), never `req`.
- Always annotate the return type: the entity type from `types/<entities>.type.ts` (`Promise<Product>`, `Promise<Product[]>`), a purpose-built shape when you return a subset of fields, or `Promise<void>` when nothing is returned (e.g. delete).
- `data` arguments use the input types exported by the validator (`CreateProductInput`, `UpdateProductInput`), imported with `import type`.
- Argument order: `userId` (when ownership matters) → `id` → `data` → `page, limit`.
- Signal every expected failure with `throw new AppError(status, message)`:

  | Situation | Status |
  |---|---|
  | invalid input that passed Joi (business rule broken) | 400 |
  | resource belongs to another user / role not allowed | 403 |
  | resource not found | 404 |
  | duplicate / state conflict | 409 |

  Messages are short English sentences: "Product not found".
- Never throw `Error` with a `.status`, never use status `200` or `5xx` in an `AppError`. Do not catch errors just to rethrow them; let unexpected errors bubble up.
- `getById`, `update` and `delete` always 404 when the resource does not exist.
- `update` re-checks uniqueness only for the fields being changed, excluding the current record.
- Ownership: when a resource belongs to a user, receive `userId` and throw 403 if it does not match.
- Lists return an empty array when nothing is found, never an error.
- Pagination (inline for now): `page` and `limit` arrive as `unknown` straight from `req.query`; `const pageNumber = Number(page) || 1; const limitNumber = Number(limit) || 5; const offset = (pageNumber - 1) * limitNumber;`
- Never return secrets (password hashes, tokens of other users). Pick the fields to return explicitly, and make the return type exclude them (e.g. `Omit<User, "passwordHash">`).
- A service may call another service; it never imports a controller.

## 5. Checklist

- [ ] No `req`/`res`/`next` anywhere in the file.
- [ ] Every expected failure throws `AppError` with the right status.
- [ ] Not-found checks on get-by-id, update and delete.
- [ ] Ownership checked when the resource belongs to a user.
- [ ] Sensitive fields excluded from the result and from its type.
- [ ] Arguments and return type annotated; no `any`.
