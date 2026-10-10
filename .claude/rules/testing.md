---
paths:
  - "jest.config.js"
  - "src/tests/**/*.ts"
  - "src/features/**/tests/*.test.ts"
  - "src/features/**/*.mock.ts"
---

# Testing Protocol

**Scope:** Test layout, reusable test builders, mocking conventions.

## 1. Core Philosophy

- **Three layers per feature, one file each.** `<feature>-controller.test.ts` (integration, real Express app), `<feature>-service.test.ts` (unit, repository mocked), `<feature>-validator.test.ts` (schema-only). Don't blend layers in one file.
- **Reach for the shared builders before hand-writing a test.** Most CRUD behavior (auth/permission/success checks) is identical across features and already implemented once in `src/tests/jest-controller.setup.ts` / `jest-service.setup.ts`. Only write bespoke `it(...)` blocks for behavior specific to that feature.
- **Never fake auth.** `authMiddleware` is disabled in the `test` environment (`src/app.ts`); authentication/authorization in tests is simulated purely by spying on the policy instance, not by minting real tokens.
- Not every feature has tests yet. When adding tests to an untested feature, mirror the `template` feature's three files - it's the cleanest reference for the standard CRUD pattern.

## 2. Running Tests

`pnpm test` runs jest against `APP_ENV=test` (see the `test` script). Jest config (`jest.config.js`) worth knowing:

- `testMatch`: `src/tests/**/*.test.ts` and `src/features/**/tests/*.test.ts` - a test file outside these two locations won't run.
- `bail: 3` - stops after 3 failing test files, not 3 failing assertions.
- `clearMocks: true` is set globally, but call/mock **state** reset still needs explicit `jest.restoreAllMocks()` (usually in `afterEach`/`beforeEach`) to remove spies between tests.
- ESM + `ts-jest` (`extensionsToTreatAsEsm: ['.ts']`, `preset: 'ts-jest/presets/default-esm'`) - this is why test files use top-level `await` freely (e.g. `const basePath = (await accountRoutes()).basePath;`).
- `maxWorkers: 2` - **do not raise it.** See §2.1.

### 2.1. A green run can be a lie

Two settings make `pnpm test` report success while hiding work, so read the *test count*, not just the colour:

- **`bail: 3` truncates the run.** After 3 failing files jest stops and prints a summary like `3 of 39 total`. That is not a full run and its numbers cannot be compared against another run.
- **A SIGKILLed worker silently drops a whole file.** Jest reports `Test suite failed to run … terminated by another process: signal=SIGKILL` and moves on, so every test in that file simply never executes while the summary still looks plausible. This is why `maxWorkers` is pinned: jest defaults to `cpus - 1` (11 in the dev container) at ~600 MB each, far past the container's `mem_limit`. Unpinned runs lost *different* files each time, each reporting a plausible-looking total tens of tests short of the real one.

For a trustworthy full run when something is failing:

```bash
docker exec -e NODE_OPTIONS=--experimental-vm-modules -e APP_DEBUG=false -e APP_ENV=test -e NODE_ENV=test $DOCKER_CONTAINER pnpm exec jest --bail=0
```

Then confirm `grep -c "Test suite failed to run"` is 0 before trusting the totals. Note `pnpm test -- --bail=0` does **not** work - the `--` reaches jest as a literal test-path pattern and matches nothing.

If the container's memory limit changes, re-check the worker count: the suite peaks at ~2.4 GB against a 4g `mem_limit`.

### 2.2. Mocking an ES module

`jest.mock()` does not hoist under the ESM preset. To replace a module-level function (something imported as `import { queueEmail } from '...'` rather than a method on an injected singleton), register the mock first and import the subject dynamically:

```typescript
const queueEmail = jest.fn<(template: EmailTemplate, to: EmailAddressType) => Promise<void>>();

jest.unstable_mockModule('@/providers/email.provider', () => ({ queueEmail }));

const { AccountEmailService } = await import('@/features/account/account-email.service');
```

There are no helper-level unit tests: `src/tests/helpers/*.unit.ts` was deleted on 2026-07-26 because the `.unit.ts` suffix never matched `testMatch`, so those 29 cases had never run and had drifted out of date. `date.helper`, `string.helper`, `system.helper` and `meta-data.helper` are therefore uncovered - worth rewriting as `*.test.ts` when one of them changes.

### 2.3. Rate limiting is off under `test`

`rate-limit.config.ts` skips limiting when `Configuration.isEnvironment('test')`. The Redis store's `init` opens no connection, so building the limiters under `test` never reaches for Redis. One limiter instance is cached per type, so `register`, `passwordRecover` and `emailConfirmSend` share a single 10-per-15-minute budget that would otherwise accumulate across an entire file - adding a case anywhere could push an unrelated one into a 429.

## 3. Mock Data (`<feature>.mock.ts`)

Every tested feature has a `<feature>.mock.ts` exporting:

- `get<Feature>EntityMock()` - a full, realistic entity object (including `id`, timestamps).
- `<feature>InputPayloads` - an object keyed by validator action (`create`, `update`, `find`, ...) with **raw request-shaped** payloads (what a client would send).
- `<feature>OutputPayloads` - the same actions, but **validated/service-shaped** payloads (what the validator would produce, used to drive service-layer tests directly without going through validation).

## 4. Controller Tests (Integration)

Boot the real app once per file and hit it with `supertest`; only service and policy methods are mocked - routing, middleware, validation, and the response envelope all run for real.

Shared builders live in `@/tests/jest-controller.setup` - read it for the full set. Each generates the standard 401/403/2xx triad; pass the route, the real policy/service singleton, and mock data.

For non-standard actions (auth flows, custom endpoints like `account.controller.ts`'s `login`/`passwordRecover`), write `describe`/`it` blocks directly, following the same shape: spy the policy, spy the services the action calls, assert on `response.status` and `response.body`. Wrap assertions in `withDebugResponse(() => { ... }, response)` - on failure it dumps the actual response body via `console.debug`, which is the primary way to diagnose a failing controller test.

## 5. Policy Mocking

`@/tests/mocks/policies.mock` spies on the policy instance's underlying checks, not the `canX` methods directly:

- `notAuthenticatedSpy(policy)` - `isAuthenticated` → `false` (simulates a 401 case).
- `isAuthenticatedSpy(policy)` - `isAuthenticated` → `true` only (use when testing a `notAuth()`-gated action that should reject an authenticated caller with 403).
- `notAuthorizedSpy(policy)` - authenticated, not admin, no permission (403 case).
- `authorizedSpy(policy)` - authenticated, not admin, has permission (the success case).

Call one of these at the top of each `it(...)` before making the request - never construct a real JWT/session for a controller test.

## 6. Service Tests (Unit)

Mock the repository, instantiate the real service class against the mock, assert on repository/query calls and return values.

From `@/tests/jest-service.setup` (read it for the full builder list):
- `createMockRepository<Entity, Query>()` / `createMockContentRepository(...)` - returns `{ query, repository }`, both fully jest-mocked (every `RepositoryAbstract` chain method returns `this`; execute methods - `save`, `delete`, `firstOrFail`, `all`, ... - are plain `jest.fn()`s you configure per test with `.mockResolvedValue(...)`).
- `setupTransactionMock()` - stubs `dataSource.transaction(...)` for services that wrap writes in a transaction.

Only hand-write `it(...)` blocks for feature-specific methods (e.g. `TemplateService.findByLabel`).

## 7. Validator Tests (Schema-Only)

No app, no mocking - just `.safeParse()` against known-good and known-bad payloads, looped over the validator's action list.

Use `withDebugValidated(() => {...}, validated)` (`@/tests/jest-validator.setup`) the same way as `withDebugResponse` - it dumps the zod result on assertion failure.

## 8. Mocking Rule of Thumb

Always `jest.spyOn(singletonInstance, 'method').mockResolvedValue(...)` on the real exported service/policy singleton (e.g. `templateService`, `accountPolicy`) - never `jest.mock('@/features/.../x.service')` to replace the whole module. The controller under test imports the same singleton, so spying on it is what makes the integration test work without a real database.
