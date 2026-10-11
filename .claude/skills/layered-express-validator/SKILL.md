---
name: layered-express-validator
description: How to write Joi request-body schemas for an Express API. Use when creating or editing any v1/validators/*.validator.ts file or adding validation to a POST/PATCH endpoint.
---

# Joi validators

## 1. Location & naming

- File: `v1/validators/<entities>.validator.ts` (e.g. `products.validator.ts`).
- Schemas: `create<Entity>Schema`, `update<Entity>Schema`; custom actions `<verb><Entity>Schema` (e.g. `loginUserSchema`, `changeUserRoleSchema`).
- Input types, in the same file: `Create<Entity>Input`, `Update<Entity>Input`; custom actions `<Verb><Entity>Input` (e.g. `LoginUserInput`).

## 2. Responsibilities

- Does: shape, type, format and range checks on the request body.
- Never: database lookups, uniqueness checks or business rules (those belong in the service).

## 3. Template

[templates/products.validator.ts](templates/products.validator.ts)

## 4. Rules

- Every POST/PATCH endpoint with a body has a schema, used through `validateBodyMiddleware`.
- Every schema has a matching exported input type describing the validated output (after `.trim()` etc.):
  - `export interface Create<Entity>Input { ... }` — fields without `.required()` are optional (`description?: string`); enums are string-literal unions (`status?: "active" | "inactive"`).
  - `export type Update<Entity>Input = Partial<Create<Entity>Input>;`
  - Pass the type to Joi so keys are checked against it: `Joi.object<Create<Entity>Input>({ ... })`.
  - Keep the interface and the schema in sync: adding, removing or renaming a field changes both.
- `update<Entity>Schema` is derived from the create schema with `.fork([...requiredFields], (field) => field.optional())` plus `.min(1)`, so a PATCH needs at least one field and never requires everything.
- Every rule has a custom English message in `.messages({...})`. Use `{#limit}` instead of hardcoding numbers.
- Strings: `.trim()` on user-typed text; `.email()` for emails; `.uri()` for URLs.
- Enums: `.valid("a", "b")` with an `"any.only"` message listing the options.
- Do **not** use `.default()`: defaults belong to the database/service, and a default in a create schema leaks into the derived update schema.
- Never accept privileged fields from public endpoints (e.g. `role`, `plan`, `id`, `userId` in a register schema). Unknown keys are rejected by Joi by default; keep it that way.
- Ids: validate their format (`Joi.number().integer().positive()` for SQL ids; adjust to the project's id type).

## 5. Checklist

- [ ] Both `create<Entity>Schema` and `update<Entity>Schema` exported.
- [ ] Matching `Create<Entity>Input` / `Update<Entity>Input` types exported and in sync with the schemas.
- [ ] Every rule has an English message.
- [ ] No `.default()`, no privileged fields on public schemas.
- [ ] No DB or business checks.
