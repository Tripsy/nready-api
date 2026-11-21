---
paths:
  - "src/shared/abstracts/validator.abstract.ts"
  - "src/shared/abstracts/controller.abstract.ts"
  - "src/features/**/*.validator.ts"
  - "src/features/**/locales/*.json"
  - "src/shared/locales/*.json"
  - "src/middleware/validate-params.middleware.ts"
---

# Input Validation Protocol

**Version:** 1.0.0
**Scope:** Validation structure, logic, examples.

## 1. Core Philosophy

- **Zod is the only validation library.** All request-shape validation goes through `zod` schemas built with the 
project's `BaseValidator` helpers - never hand-rolled `if` checks for type/format/length in controllers or services.
- **Validators only check shape.** A `*.validator.ts` file's job is to confirm the request data is well-formed 
(types, formats, required/optional, ranges). Authorization lives in the feature's `*.policy.ts`; 
business-rule checks (uniqueness, state transitions, etc.) live in the `*.service.ts`. 
Don't push policy or business logic into a validator, and don't push shape checks into services;
- Helpers are imported from their own file (`@/helpers/objects.helper`); there is no `@/helpers` barrel.
- Every validation failure must resolve from a locale entry
- Messages are never hardcoded strings in the validator - they're resolved through `getMessage()` / `lang()`, so both 
the message key and its locale entry must exist.

## 2. File & Class Structure

Every feature that accepts input has a `<feature>.validator.ts` exporting a class that extends `BaseValidator<typeof validatorMessages>`, where `validatorMessages` is a `const` array spreading `sharedValidatorMessages` plus the feature's own keys. `src/features/brand/brand.validator.ts` is the reference shape.

- Instantiate once per controller, passing the entity/namespace name that matches the feature's locale file: `new ProductValidator('product')`.
- Name schema properties after the controller action they validate (`create`, `read`, `update`, `delete`, `restore`, `find`, `statusUpdate`, ...), not generic names like `schema` or `bodySchema`.

## 3. Messages

Validation messages reach the client as finished English text (`src/config/message.setup.ts`), never as a key.

- `getMessage(key, replacements?)` resolves the right namespace automatically:
  - If `key` is one of `sharedValidatorMessages` (defined in `validator.abstract.ts`), it resolves to `shared.validation.<key>` → `src/shared/locales/en.json`.
  - Otherwise it resolves to `<entity>.validation.<key>` → `src/features/<feature>/locales/en.json`.
- **Never inline a literal error string** in a validator schema - always go through `getMessage()`, and add the corresponding key under `"validation"` in the feature's `locales/en.json` (or `shared/locales/en.json` for shared keys). A validator referencing a message key that doesn't exist in the locale file is a bug, not just a lint nit.
- Extend the feature's local `validatorMessages` array with any keys beyond `sharedValidatorMessages` - this is what gives `getMessage()` its type-safe key union.

## 4. Partial Update Pattern

`update` schemas must:
1. Make every field optional (`{ required: false }`).
2. `.refine((data) => hasAtLeastOneValue(data, paramsUpdateList), ...)` to reject empty-body
   updates, using the shared `params_at_least_one` message with `path: ['_global']`.
3. Keep a `paramsUpdateList` string array (exported from the validator file) listing the updatable field names, interpolated into the `params_at_least_one` message.

**Pass `paramsUpdateList` to the check - it is not optional.** The controller merges the path
`id` into the payload before validating (§5), and `id` is a required field on the schema, so a
check over the whole object always finds a value and can never fire. The list must therefore
name **every** updatable field: one left out is a field that can no longer be sent on its own.
Equally, never add a *required* path parameter to it - `section` / `entity_id` on `image`'s
`/:section/:entity_id` routes, `user_id` on `user-permission` - since those are always present
and would defeat the check exactly as `id` does.

**Discriminated unions need a second list.** `client` and `template` discriminate their update
union on `client_type` / `type`, and the controller fills that field in from the stored row
when the body omits it (§5), so it is always present too. It belongs in `paramsUpdateList` -
it is genuinely updatable and the message should say so - but not in what the check counts.
Derive the checked list from the full one so the two cannot drift:

```typescript
const paramsUpdateCheckList = paramsUpdateList.filter(
  (param) => param !== 'client_type',
);

.refine((data) => hasAtLeastOneValue(data, paramsUpdateCheckList), {
  message: this.getMessage('params_at_least_one', {
    params: paramsUpdateList.join(', '),
  }),
  path: ['_global'],
});
```

The same list drives both the check and the message, so they cannot drift: if the message
names a field, that field is genuinely accepted. Don't patch extras into the message
(`[...paramsUpdateList, 'contents']`) - put them in the list.

## 5. Controller Integration

Controllers extend `BaseController` and call `this.validate()` (`safeParse`) - never call a validator's `.parse()`/`.safeParse()` directly in a controller or service.

- On failure, `this.validate()` writes issues to `res.locals.output.errors(...)` and throws `UnprocessableContentError` - don't catch and re-wrap these; let them propagate to the error-handler middleware. A falsy `sourceData` throws `BadRequestError` before the schema runs.
- Validate `req.params` for path IDs (`read`/`delete`/`restore`), `req.body` for writes, `req.query` for `find`. For `update`, merge `req.params.id` into the body payload before validating (`{ ...req.body, id: req.params.id }`).

**Match the source to the route, and merge when the route has path params.** `req.query` alone is correct only for `find`, whose path is `''`. Any action whose route declares `:params` must include them, or the schema receives `undefined` and the endpoint rejects every request with `invalid_id` - a 422 that no amount of correct client input can avoid. This has shipped twice:

```typescript
// WRONG - route is `/:id`, so `id` is never in the query string
const data = this.validate(this.validator.delete, req.query, res);

// RIGHT - `id` from the path, `force` from the query string
const data = this.validate(
  this.validator.delete,
  { ...req.query, id: req.params.id },
  res,
);
```

When the route contributes several params (`/:id/status/:status`) spread both objects, path last so it wins: `{ ...req.query, ...req.params }`.

## 6. Route-Level Param Middleware

For a cheap pre-check before a request even reaches the controller/validator (e.g. rejecting a malformed `:id` early), use the route middleware in `validate-params.middleware.ts`:

- `validateParamsWhenId('id', ...)` - rejects path params that are not a UUID.
- `validateParamsWhenEnum({ status: Object.values(StatusEnum) })` - rejects path params outside an allowed value set.

These are a fast-fail layer only - they don't replace the full `*.validator.ts` schema validation in the controller.
