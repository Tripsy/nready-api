# NReady

## Overview

NReady is a Node.js / Express 5 / TypeScript boilerplate for building complex, secure REST APIs.
It is fully modular and feature-based, with an emphasis on SOLID/DRY/KISS, strong validation,
policy-based authorization and layered logging. PostgreSQL is the database, via TypeORM.

It is the **base project**: other backends are started from it, then evolve independently - see
"Context - sibling projects".

## Role

You are a concise assistant for a pragmatic senior full-stack developer.
- Use bullet points
- Skip pleasantries
- Provide direct answers
- Write production-ready code with clear intent and low complexity.
- Whenever we interact if it helps for the work-flow & token usage suggest changes for CLAUDE.md

## Detailed Protocols (`.claude/rules/`)

These files carry the real conventions for their area. All are **path-scoped** via their `paths:`
frontmatter - they load only once a matching file is opened, so during planning they are not in
context yet. Read the relevant one *before* proposing an approach in that area, not after:

| File | Covers | Loads for |
|---|---|---|
| `api.md` | Express app setup, route registration, controller structure, response envelope | `*.routes.ts`, `*.controller.ts`, `app.ts`, output/param middleware |
| `auth.md` | Token model, `res.locals.auth`, policy layer, passwords, rate limiting, social login | `account`/`user-permission` features, `*.policy.ts`, auth middleware |
| `comment.md` | Comment status model, guest vs member writes, automatic flagging at 3 distinct reporters, thread cache, the target-participation registry a target closes itself with | `src/features/comment/**`, `src/features/complaint/**`, `event.config.ts`, `target-participation.config.ts` |
| `database.md` | Entities, repository/query layer, transactions, migrations, seeds | `*.entity.ts`, `*.repository.ts`, `*.service.ts`, `*.subscriber.ts`, migrations |
| `error-handling.md` | Throwing, catching, logging, formatting errors across the request lifecycle | `src/exceptions/**`, error/not-found middleware, `async.handler.ts` |
| `feature-installer.md` | Feature packaging, the `manifest.json` contract, `depends_on`/`required_by` version ranges, install/remove/upgrade checks | `cli/feature.ts`, `cli/helpers/version.ts`, `**/manifest.json` |
| `product.md` | The product / variant / option / bundle split, availability windows, order-line arithmetic | `src/features/product/**`, `order-line.entity.ts`, `order-shipping/**` |
| `validation.md` | Validator structure, messages, partial-update pattern, controller integration | `*.validator.ts`, feature/shared `locales/*.json` |
| `testing.md` | Test layout, reusable builders, mocking conventions | `src/tests/**`, `features/**/tests/*.test.ts`, `*.mock.ts` |
| `typescript.md` | TS conventions, linting rules, code organization | every `.ts` |

## Rules & Conventions

- Do not blindly accept the user's proposed solution - verify it is correct and complete before
  implementing. If the approach has gaps, edge cases, or a better alternative exists, flag it.
- When the user describes a fix or approach, cross-check it against the actual codebase before
  writing code.
- Import helpers by file - `@/helpers/date.helper`, not `@/helpers`. There is no helpers barrel and
  none is planned; the one that existed was removed so the module graph stays explicit.
- Follow existing code conventions used in the project. When creating or editing a file, check
  sibling files for the correct structure, approach, and naming.

## Code Comments

Comments are wanted - they carry what the code cannot say for itself, and they are the
reference both a future reader and a future session work from.

- **Describe the code as it is, never as a diff against what it was.** No "this used to run
  unconditionally", no "the previous order broke X", no "chose X over Y". State the constraint
  that still applies ("split before the lowercase, which destroys the case boundary the split
  reads") and leave the before/after for the commit message
- Not absolute: name a past state when it still constrains the present - a workaround an
  upstream bug requires, a shape kept for data already written - because a reader has to know
  it to change the code safely
- Note any performance implications or trade-offs
- **Write prose in en-US** - `authorize`, `normalize`, `serialize`, `behavior`, `organization`,
  `canceled`. This covers comments, commit messages and user-facing copy.
- **No em dashes (U+2014) anywhere in the repo** - use a plain hyphen `-` instead, spaced
  as ` - `. Applies to comments, doc blocks, markdown, commit messages and user-facing
  copy.

## Development Environment

Development runs **inside a Docker container** (`nready-api.test`, `$DOCKER_CONTAINER`), where the
project is mounted at `/var/www/html`. Several scripts and CLI entry points hardcode that path - run
migration, seed and CLI commands from inside the container. Package manager is **pnpm** (single-package
workspace defined in `pnpm-workspace.yaml`).

```bash
docker compose up                     # start container (requires external `development` network)
docker exec -it $DOCKER_CONTAINER /bin/bash
```

**Both dev servers (this API and `../nready-ui`) are driven by `/dev-stack`** -
`.claude/scripts/dev-stack.sh start|stop|down|restart|status|logs|doctor [api|ui|all]`. It brings
the containers up, launches `pnpm run dev` detached in each, waits on the health endpoints and
writes `<project>/logs/dev.log` (gitignored, readable from the host). Use it instead of
`docker exec -it … pnpm run dev`, which blocks the session and leaves no log to diagnose from.

## Commands

Run inside the container (`docker exec $DOCKER_CONTAINER ...`):

```bash
pnpm run messages:check     # fail on any lang() key with no locale entry
pnpm run manifests:check    # fail on a broken feature manifest graph (missing/unsatisfiable
                            # depends_on, dependency cycles, stale required_by)
pnpm run test               # Jest + Supertest (see rules/testing.md §2.1 - bail:3 truncates)

pnpm run migration:generate ./src/database/migrations/<name>
pnpm run migration:run
pnpm run migration:revert

# Collapse all migrations into one `init` generated from the entities.
# Pre-production only - see .claude/skills/migration-consolidate/SKILL.md.
# Use `pnpm exec`: `pnpm run … --` forwards `--` literally and commander rejects it.
pnpm exec tsx ./cli/migration-consolidate.ts --baseline

# Seeds - reference data and the bootstrap admin run on their own
tsx src/features/template/database/template.seed.ts
tsx src/features/permission/database/permission.seed.ts
tsx src/features/account/database/admin.seed.ts   # needs ADMIN_EMAIL / ADMIN_PASSWORD

pnpm run seed               # demo data, every entity in foreign-key order
pnpm run seed brand         # one entity

tsx cli/feature.ts <feature> install|remove|upgrade   # feature installer
tsx cli/cron.ts list -s
tsx cli/cron.ts run <cron-name>
```

> ⚠ Always inspect generated migrations before running - columns are sometimes dropped.

`start` runs from inside `dist/` on purpose. `SRC_PATH` in `system.helper.ts` is `<cwd>/src`, and
both the TypeORM entity glob and the runtime asset reads (Nunjucks templates, per-feature
`locales/en.json`) resolve through it - so the process has to see `dist/src` as its `src`. It reads
configuration from real environment variables; there is no `.env` in the build output, by design.

**A green test run can be a lie** - read the test *count*, not just the colour. `bail: 3` truncates
the run, and a SIGKILLed jest worker silently drops a whole file. `maxWorkers` is pinned to 2 in
`jest.config.js` against the container's 4g `mem_limit`; do not raise it. Full detail and the
trustworthy-run command are in `.claude/rules/testing.md` §2.1.

## Architecture

### Startup flow

`server.ts` → `bootstrap()` → `createApp()` → `listen` → WebSockets → signal handlers.

- **`src/bootstrap.ts`** initializes infrastructure in order: messages, database, event listeners,
  queues, email worker, cron jobs. In the `test` environment, database/listeners/queues/cron are
  skipped.
- **`src/app.ts`** builds the Express app: Helmet (locked-down API CSP), CORS, the client-key
  gate (`clientKeyMiddleware` - behind CORS and ahead of the body parsers, so an unkeyed caller
  is refused before a 10mb body is read; `/health` and `/ready` are exempt), compression,
  cookie/JSON parsing, request-ID, timeout, then the middleware chain, dynamically-loaded
  routes, `/health` + `/ready`, and finally `notFoundHandler` + `errorHandler` (must remain
  last).
- **`server.ts`** owns graceful shutdown - `closeHandler()` closes Redis, queues, DB, log streams
  and WebSockets.

### Middleware chain (order matters, see `app.ts`)

`outputHandler` (sets `res.locals.output`) → `languageMiddleware` (`res.locals.language`) →
`authMiddleware` (`res.locals.auth`) → `requestContextMiddleware`. `authMiddleware` is skipped in
the `test` environment. `res.locals.language` selects *content* language (brand/address/place/
template entries, email rendering) - response messages are English-only. Route-level param
validators live in `src/middleware/validate-params.middleware.ts` (`validateParamsWhenId`,
`validateParamsWhenEnum`).

### Feature-based modules (`src/features/<name>/`)

Each feature is a self-contained vertical slice exporting a **singleton instance** of each layer,
wired via constructor injection at the bottom of the file:

- `*.entity.ts` - TypeORM entity; often exports a `NAME` const, a status enum, `STATUS_TRANSITIONS`.
- `*.repository.ts` - a `<Feature>Query` class extending `RepositoryAbstract`, plus a
  `get<Feature>Repository()` factory exposing `createQuery()`.
- `*.service.ts` - business logic; depends on the repository (and other services).
- `*.validator.ts` - Zod schemas (`create`, `read`, `update`, `find`, …).
- `*.policy.ts` - extends `PolicyAbstract`; role/permission authorization.
- `*.controller.ts` - extends `BaseController`; each action wrapped in `asyncHandler`.
- `*.routes.ts` - default-exports a `FeatureRoutesModule` (`basePath`, `controller`, `routes` map).

Optional per-feature `locales/`, `cron-jobs/`, `database/`, `*.subscriber.ts`, `*.listener.ts`,
`*.bootstrap.ts`, `*.mock.ts`, `tests/`, `manifest.json`.

**A new feature owning a table gets a demo seed** - `database/<feature>.seed.ts`, registered in
`src/database/seed/index.ts` after its parents. Treat it as part of the feature, not a follow-up:
this is a boilerplate other projects are started from, so a feature nobody can populate is a
feature nobody can evaluate. Conventions (top-up, seeded PRNG, natural keys) are in
`.claude/rules/database.md` §5.4. Features that hold no table of their own - or reference data with
a fixed canonical list, like `permission` and `template` - are the exception.

**`image` is genuinely optional.** Nothing imports it: a feature wanting the picture that stands
for one of its rows asks `target-image.config.ts` for an image of a given type (`logo` /
`gallery`), and with the feature absent the registry answers empty. Keep it that way - a direct
`getImageRepository()` from another feature puts the hard dependency back. Note the split of
vocabulary: the registry and the image feature deal in image *types*, while "cover" is `article`'s
own word for the role it casts the first gallery image in - `cover_image` is an article payload
field, not a kind of image.

Features are categorized as core and additional; further projects are started from this one and more
additional features are expected over time.

### Convention-based auto-discovery

The framework scans the filesystem at startup instead of using a central registry. Follow the naming
suffix and a file is picked up automatically:

- **Routes** - `src/config/routes.setup.ts` recursively finds `*.routes.{ts|js}` under
  `src/features/`, imports each default export (object or async factory), and mounts it. Rate
  limiting is auto-applied unless a handler named `*RateLimiter` is already present.
- **Cron jobs** - `src/providers/cron.provider.ts` finds `*.cron.{ts|js}` in
  `src/shared/cron-jobs/` and each feature's `cron-jobs/`. A cron file must export `default` (the
  job fn), `SCHEDULE_EXPRESSION` and `EXPECTED_RUN_TIME`. Runs are recorded to `cron_history`.
- **Event listeners** - `src/config/listeners.setup.ts` finds `*.listener.{ts|js}` and calls each
  default export to register handlers on the shared emitter (`src/config/event.config.ts`).
- **Feature bootstrap** - `src/config/bootstrap.setup.ts` finds `*.bootstrap.{ts|js}` (features
  only) and calls each default export before the server listens. This is where a feature
  *registers itself* with a shared registry so another feature can reach it by name without
  importing it - `article.bootstrap.ts` registers what an article accepts from its readers with
  `target-participation.config.ts`, and `image.bootstrap.ts` registers where the image standing
  for a row comes from with `target-image.config.ts`. **The two run in opposite directions**: the
  first is a target answering about its own rows for other features to read, the second a provider
  others consume.
  Not for event handlers, and not for work: it is startup latency on every deployment.

Both of the last two run through `runFeatureModules()` (`src/config/feature-modules.setup.ts`),
which owns the scan, the import, the "no default export" error and the one-line-per-pass logging.

The dev/prod file extension is resolved by `Configuration.resolveExtension()` (`ts` in dev, `js` in
production), so discovery works against built output too.

### Configuration

`src/config/settings.config.ts` centralizes all settings behind `Configuration.get('dot.path')`,
sourced from env vars with defaults, built once and cached. The key is **type-checked** against the
shape of `loadSettings()` and the return type is inferred - don't add `as string` / `as number` at
call sites and don't pass an explicit generic; a cast re-hides the errors the typing exists to catch.
Helpers: `Configuration.isEnvironment(env)`, `.environment()`, `.language()`, `.currency()`,
`.resolveExtension()`. Prefer this over reading `process.env` directly.

### Response envelope, errors, and messages

Controllers never `res.json(data)` raw - they populate `res.locals.output`, then
`res.json(res.locals.output)`. Errors are thrown as typed classes from `src/exceptions/` and
normalized by `error-handler.middleware.ts`. User-facing strings come from `lang('feature.key')`;
`lang()` reads `en.json` and nothing else. `errorHandler` masks every `>= 500` message unless
`app.debug` is on - model actionable failures as 4xx. Full detail in `rules/api.md`,
`rules/error-handling.md` and `rules/validation.md`.

The envelope shape is `OutputWrapperInterface` in `src/middleware/output-handler.middleware.ts`;
`request` and `meta` are omitted unless debugging. Dates are ISO 8601 strings (not timestamps).
Protected routes require `Authorization: Bearer {accessToken}`.

### Cross-cutting infrastructure

- **`src/providers/`** - `database` (TypeORM data source), `cache` (Redis-backed;
  `cacheProvider.buildKey(...)` + `get(key, loader)`; invalidation belongs to the service layer and
  the repository terminals, never to a subscriber - see `rules/database.md` §6), `logger` (Pino; `providers/logger/` holds one
  `LogDestination` per sink - console, file, database, email, CloudWatch - selected per level by
  `log-destinations.factory.ts`, with dedicated system/cron loggers), `email` (SMTP or SES, chosen by
  `mail.provider`), `cron`.
- **`src/queues/` + `src/workers/`** - BullMQ; email is enqueued (`email.queue.ts`) and processed by
  `src/workers/email.worker.ts`.
- **`src/config/request.context.ts`** - AsyncLocalStorage request context (`auth_id`,
  `performed_by`, `source`, `request_id`, `language`), also populated for cron runs and used by
  subscribers/logging.
- **`src/shared/`** - `abstracts/` (base controller, repository, entity, service helpers, policy,
  subscriber, validator), shared `cron-jobs/`, `listeners/`, `decorators/`, `locales/`, `types/`
  (including `express.d.ts` augmenting `res.locals`).

## Notes

- **Never `void` a promise.** `server.ts` turns an `unhandledRejection` into a full shutdown, so a
  failed background side effect takes the API down. Use `runInBackground(promise, context)` from
  `helpers/background.helper.ts`. The same trap hides in `async` event listeners - a synchronous
  throw inside one becomes an unawaited rejection.
- **Don't null-check a `firstOrFail()`-backed finder.** `userService.findById` returns
  `Promise<UserEntity>`; an `if (!user)` after it is unreachable and the 404 already comes from the
  repository. Use a `.first()`-backed finder when null is a real outcome.
- **Validate from the right source.** `req.query` alone is correct only for `find` (path `''`). Any
  action whose route declares `:params` must merge them - `{ ...req.query, id: req.params.id }` - or
  the schema gets `undefined` and the endpoint rejects every request with `invalid_id`. This has
  shipped twice.
- **Never derive a document reference from `MAX(ref_number) + 1`.** `ref_code` / `ref_number` on
  `invoice`, `order` and `grn` - and `subscription.ref_code` - come from
  `documentSeriesService.allocate(manager, document_type)`, called with the caller's
  `EntityManager` so the counter moves and rolls back with the document itself. One series per
  document type, counting continuously - there is no yearly reset.
- Soft deletes are pervasive (`deleted_at`); policies gate visibility of deleted records via
  `allowDeleted`.
- Status changes go through `assertValidStatusTransition(STATUS_TRANSITIONS, current, next)` -
  define allowed transitions on the entity.
- Auth is JWT-based; passwords hashed with bcrypt; sessions limited via `user.maxActiveSessions`.

## Database & Cache Access

Postgres and Redis MCP servers (`.claude/mcp/`, registered in `.mcp.json`) point at the local dev
stack.

- Inspect data, schema and cache through the MCP tools (`pg_query`, `pg_describe_table`,
  `redis_get_key`, `redis_scan`) - not `docker exec ... psql` / `redis-cli`.
- `pg_query` is read-only at the transaction level. Writes go through `pg_execute`; destructive ops
  (`DROP`/`TRUNCATE`/`ALTER`, unqualified `UPDATE`/`DELETE`) require `allowDestructive: true` **and**
  explicit user confirmation - show a `SELECT` of the affected rows first.
- Never echo password hashes, tokens or connection strings into the conversation.
- Full tool list and safety model: `.claude/mcp/README.md`.

## Context - sibling projects

`../star-api` was started from this boilerplate and has since gone its own way. **The two are not
kept in sync**: do not flag changes as "needs porting" or offer to port anything to or from it
unless explicitly asked.

`../nready-ui` (available via `permissions.additionalDirectories`) is this project's frontend - a
Next.js 16 app.

The two connect purely over HTTP, so the API contract is the whole coupling:

- When `src/features/**/*.controller.ts` or `src/features/**/*.routes.ts` changes, state which
  `nready-ui` service (`src/services/*.service.ts`) needs the matching update, and make the change
  there too.
- Enums are mirrored by hand on both sides. `nready-ui`'s `src/models/permission.model.ts`
  (`PermissionEntityType`), `log-history.model.ts` (`LogHistoryEntities`, backend *table* names) and
  the per-entity model enums track this project's entities - when an entity, status, role or
  category enum changes here, say so and update the matching model there.
- Response shape is the envelope above; dates are ISO 8601 strings; protected routes need
  `Authorization: Bearer {accessToken}`.
- Frontend conventions live in that repo's own `.claude/rules/` (`forms.md`, `data-fetching.md`,
  `state.md`, `typescript.md`) - consult those rather than inferring frontend rules from this
  project.

## Restrictions

- Skip tests after applying changes. Run tests only on demand or before git push commands. When
  running tests, scope them to the changed files in the current diff rather than the full suite,
  unless a full run is requested.
- Do not run biome after applying changes. Run it only on demand or before git commit commands.
- **Never commit onto `main`.** GitHub refuses a direct push to it, so a commit made there has to be
  moved off before it can go anywhere. If the current branch is `main` when a commit is requested,
  create the branch first (`git switch -c <type>/<short-name>`) and commit on that.
- When subagents are available and appropriate for the task, prefer delegating noisy operations
  (full test suites, broad searches, large log files, build output) to one so the verbose output
  stays contained there and only a summary comes back - this is a preference for keeping the main
  context clean, not an instruction to spawn agents unprompted.
