---
paths:
  - "src/config/data-source.config.ts"
  - "src/database/migrations/*.ts"
  - "src/features/**/*.entity.ts"
  - "src/features/**/database/*.seed.ts"
  - "src/features/**/*.repository.ts"
  - "src/features/**/*.subscriber.ts"
  - "src/features/**/*.service.ts"
  - "src/shared/abstracts/entity.abstract.ts"
  - "src/shared/abstracts/repository.abstract.ts"
  - "src/shared/abstracts/subscriber.abstract.ts"
---

# Database Interaction Protocol

**Scope:** Entities, the repository/query layer, transactions, migrations and seeds.

**See also:** `product.md` - the `product` / `product_variant` / `product_option` split. The rules
here describe how to write an entity; that file describes which of those three tables a piece of
information belongs to, which the columns alone do not reveal. Read it before adding a column to any
`product*` entity or to `order_line`.

## 1. Core Philosophy

- **Never interpolate a value into SQL.** `filterBy` / `filterAny` / `filterById` parameterize
  automatically; `filterRaw` takes a parameters object. Building a condition with a template literal is
  the one thing in this layer that turns a bug into a vulnerability.
- **Migrations are the only way the schema changes.** No `synchronize`, no manual `ALTER` against a
  live database - a change that isn't in `src/database/migrations/` doesn't exist for the next
  environment.
- **Soft delete is the default.** Business entities carry `deleted_at` and are removed with
  `delete(true, ...)`; a hard delete is a deliberate exception, not a shortcut.
- **Go through `RepositoryAbstract`.** A service that holds a bare TypeORM `Repository<T>` loses the
  filter guards, soft-delete handling and standardized not-found errors that everything else relies on.

## 2. Entity Standards

### 2.1. Naming

- **Tables:** `snake_case`, singular (`user`, `order_item`).
- **Columns:** `snake_case`, singular. Property names match the DB column exactly - no camelCase with a
  `name:` mapping.
- **Primary keys:** `id`, auto-incrementing `int`, provided by `EntityAbstract`. Not UUIDs.
- **Foreign keys:** named after what they reference (`user_id`, `company_id`).
- **Timestamps:** `created_at` / `updated_at` on every table, `deleted_at` on anything soft-deletable -
  all three come from `EntityAbstract`.

### 2.2. Structure

Every entity extends `EntityAbstract` (`src/shared/abstracts/entity.abstract.ts`), which already
provides `id`, `created_at`, `updated_at` and `deleted_at`. Do not redeclare them.
`src/features/brand/brand.entity.ts` is the reference shape.

- Default-export the class; expose `static readonly NAME` (the table name, reused by policies and
  repositories) and `HAS_CACHE`.
- Enums are a const object plus a derived union, never a TypeScript `enum`.
- `ON DELETE CASCADE` sparingly - prefer `RESTRICT` or `SET NULL` unless the child has no meaning
  without its parent.
- Push invariants the database can hold into a `@Check` constraint rather than relying on application
  code alone; `cash-flow.entity.ts` is the reference (`@Check('(amount > 0)')` plus a direction/amount
  consistency check).

### 2.3. Don't index `deleted_at`

**A soft-deletable table gets no index on `deleted_at`.** Every entity used to carry
`(deleted_at) WHERE deleted_at IS NULL` via a `@SoftDeleteIndex` decorator, and
`1789900000000-drop-soft-delete-indexes.ts` removed all 47 of them.

The predicate keeps every live row, and a soft delete here is a person removing a record - so the
index holds all but a rounding error of the table and gives the planner nothing to narrow with.
Measured at 500k rows with 2% deleted, it was chosen by none of the shapes this codebase issues
(selective equality + `deleted_at IS NULL`, skewed enum + the same, paginated `ORDER BY id DESC
LIMIT`, and the `COUNT(*)` behind pagination) - `deleted_at` is applied as a filter over a plan
picked for the other predicate. It cost one extra buffer touch per row inserted.

Two things to know before reintroducing one:

- **It looks used on a small database.** Under a few hundred rows the planner `BitmapAnd`s it
  against the selective index because every estimate is a rounding error there. A high `idx_scan`
  counter in dev is an artifact of the row count, not evidence.
- **It earns its place only once soft-deleted rows dominate the table** - at 81% deleted it was
  chosen outright, the predicate having turned selective. Reach for a purge before an index, and
  if you do add one, add it to that one table on measurement rather than as a default.

What *does* need an index is the parent key of any table whose `sync*` reads with `withDeleted`,
and it must be **non-partial** - see §3.1 and `1789600000000-product-sync-read-indexes.ts`.

## 3. Repository & Query Layer

This is Express + TypeORM with plain module singletons - there is no DI container, so no `@Injectable()`
and no `@InjectRepository()`. A feature's `<feature>.repository.ts` exports **two** things: a query
class named `<Feature>Query` (not `<Feature>Repository`), and a factory that extends TypeORM's
repository with a `createQuery()` hook.

`src/features/brand/brand.repository.ts` is the reference for both halves.

- Pass `Entity.NAME` to `super()`, not a hand-written string - the entity already owns its table name.
- A service takes the repository in its constructor, typed off the factory
  (`constructor(private repository: ReturnType<typeof getProductRepository>) {}`), and is exported as a
  singleton built with it (`export const productService = new ProductService(getProductRepository())`).
  Each query starts a fresh chain with `this.repository.createQuery()`.

### 3.1. Query Rules

```typescript
// ✅ SAFE - auto-parameterized
this.filterBy('email', userInput);

// ✅ SAFE - raw SQL with bound parameters
this.filterRaw(
  'to_tsvector(name) @@ plainto_tsquery(:term)',
  { term: searchInput },
);

// ❌ UNSAFE - never interpolate into filterRaw
this.filterRaw(`name = '${userInput}'`); // INJECTION RISK

// ✅ soft delete a single row: delete(isSoftDelete, multiple, force)
await this.repository.createQuery().filterById(userId).delete(true, false);

// ❌ throws `db_delete_missing_filter` - an unfiltered delete is refused
await this.repository.createQuery().delete();

// ⚠️ force bypasses that guard and deletes everything - admin scripts only
await this.repository.createQuery().delete(true, true, true);

// ✅ eager-load instead of querying in a loop (N+1)
const user = await this.repository
  .createQuery()
  .select(['id', 'name'])
  .joinAndSelect('user.profile', 'profile', 'LEFT')
  .filterById(userId)
  .first();

// ✅ paginated list with a total
const [data, total] = await this.repository
  .createQuery()
  .select(['id', 'email'])
  .filterBy('status', 'active')
  .pagination(1, 20)
  .all(true);
```

- `select(...)` explicit columns over loading whole rows, and `pagination(...)` on anything list-shaped
  - an unbounded `all()` on a growing table is a slow query waiting to happen.
- `first()` returns nullable; `firstOrFail()` throws a `<entity>.error.not_found`. Pick the one that
  matches the caller and don't null-check the result of `firstOrFail()` (see `error-handling.md` §5).
- `withDeleted()` opts a query into soft-deleted rows - drive it from `policy.allowDeleted(auth)`
  rather than deciding per call site.

## 4. Transactions

Wrap any operation that writes to several tables, or reads then writes, in
`dataSource.transaction(async (manager) => { ... })` - `brand.service.ts` and `image.service.ts` are the
references. Keep the body short: it holds locks for its whole duration.

In tests, `setupTransactionMock()` (`@/tests/jest-service.setup`) stubs this out - see `testing.md` §6.

## 5. Migrations

### 5.1. Naming

TypeORM's timestamp convention, `{timestamp}-{description}.ts` - `1782779682393-image.ts`. Never
sequential numbers (`001-init.sql`) or plain dates (`2026-07-18-add-column.sql`): the timestamp is what
keeps ordering deterministic and avoids collisions between branches.

### 5.2. Structure

Both directions are required - a migration without a working `down()` cannot be rolled back in
production.

The shape is stock TypeORM `MigrationInterface` - `src/database/migrations/` has the examples.

### 5.3. Commands

`migration:generate` / `migration:run` / `migration:revert` are package.json scripts -
generating from entity changes is preferred over hand-writing one. Resetting the schema has no
script:

```bash
tsx ./node_modules/typeorm/cli.js schema:drop -d src/config/data-source.config.ts
```

### 5.4. Seeds

Three kinds, and they are not interchangeable:

**Reference data** - `template` and `permission`. A fixed canonical list, wipe-and-insert, each
owning its own connection lifecycle. Run them before the demo seeds.

```bash
tsx /var/www/html/src/features/template/database/template.seed.ts
tsx /var/www/html/src/features/permission/database/permission.seed.ts
```

A feature that sends its own email keeps its templates with itself, in
`features/<name>/database/<name>.templates.ts`, default-exporting a `TemplateSeedEntry[]`. The
template seed discovers those files and inserts them alongside its own list, so an additional
feature installed or removed through `cli/feature.ts` takes its templates with it and the core seed
needs no edit. Only templates the core features render belong in `template.seed.ts` itself.

**Bootstrap** - `account/database/admin.seed.ts`. Creates the first administrator so a freshly
migrated database has a way in. Credentials are read from `ADMIN_EMAIL` / `ADMIN_PASSWORD` and have
**no defaults**: a fallback would be a published administrator password the moment it runs anywhere
real. Keyed on email, so re-running is a no-op and never resets an existing admin's password.
Deliberately absent from the `seeds` array, so `pnpm run seed` stays runnable with no environment
configured.

**Demo data** - generated volume for local development, driven by `src/database/seed/`.

**Every new feature that owns a table ships with a demo seed.** It is part of the feature's
definition of done, alongside its entity and migration - not a later chore. The exceptions are
features with no table of their own and reference data with a fixed canonical list (`permission`,
`template`), which are wipe-and-insert and stay out of the orchestrator.

Conventions for a new demo seed:

- Live at `src/features/<entity>/database/<entity>.seed.ts`, export a `SeedDefinition`, and end with
  the `isDirectRun(import.meta.url)` block so the file stays runnable standalone while the
  orchestrator can import it.
- **Top up, never wipe.** Build candidate rows `0..target-1` as a pure function of the index, give
  each a natural key, and hand them to `topUp()` - it inserts only the keys not already stored.
  Clearing a table is not an option here: `order`, `invoice`, `product` and friends hold `RESTRICT`
  foreign keys, and the database holds rows worth keeping. Wipe-and-insert is reserved for closed
  reference lists like `template` and `permission`.
- Randomness comes from the injected `random`, a seeded PRNG. Never `Math.random` - a re-run has to
  reproduce the same rows or the top-up inserts duplicates.
- Register the seed in `src/database/seed/index.ts`, positioned after its parents.
- **Let the subscribers do their job.** `UserSubscriber.beforeInsert` hashes `password` and fills
  `password_updated_at`; a seed that pre-hashes ends up double-hashing and no login will match.
  Check `<entity>.subscriber.ts` before setting a column by hand.

## 6. Cache Invalidation

**Invalidation belongs to the service layer and the repository terminals. Never to a subscriber.**
A TypeORM entity subscriber cannot do this job for two reasons, and both are why the `cacheClean`
event it used to emit no longer exists:

1. *It fires per row.* Saving three translations broadcasts three identical cleans, each a full
   Redis SCAN over the same keyspace, all but the first finding nothing.
2. *It fires inside the transaction.* A concurrent reader can slip between the clean and the
   COMMIT, refill the cache from a snapshot about to be superseded, and leave it stale with
   **nothing coming to correct it** until the TTL expires.

Subscribers keep `logHistory` - an audit entry per row is exactly what that wants.

The helpers live in `shared/abstracts/service.abstract.ts` and are all **awaited inside the
request**, so a write is readable by whoever made it (the dashboard re-reads an entry the moment its
form submit resolves):

| Helper | For |
|---|---|
| `cleanEntityCache(entity, id)` | the common case - one row, keyed by id |
| `cleanEntityCacheBy(entity, ...segments)` | a keyspace addressed by something else (`template`, read by label/language/type at render time) |
| `cleanEntityCacheMany(entity, ids)` | many rows in **one** pass over the keyspace |

Rules that follow:

- **Call it after the transaction commits**, never inside one - inside is reason 2 exactly.
- **`create` needs no clean.** A new row has no cached key.
- **Patch the feature's `update()` wrapper, not its callers.** `updateData` and `updateStatus`
  route through it, so one line covers them and every external caller.
- **`RepositoryAbstract.delete/restore` clean their own affected rows**, so a caller that bypasses
  the service - the retention crons do - is still covered. They clean *every* id the filter
  reached, not the filter itself.
- **Never loop `cleanEntityCache` over a bulk write.** `MATCH` takes one glob, so that is a full
  pass over the keyspace per id; `cleanEntityCacheMany` goes wide once and filters in the client.
- **Put the id first in a cache key** - `<entity>:<id>:<group>`, never `<entity>:<group>:<id>`.
  The second shape is unreachable by every helper above and has silently outlived its writes.
- **A cached read with no invalidation is a bug**, not a TTL policy. If an entity is cached, some
  write path owns dropping it.

## 7. Query Logging

`data-source.config.ts` sets `logging: false` in every environment. Turn it on locally to debug a
query, but revert it - TypeORM's query log goes to stdout unfiltered, so it carries parameter values
(emails, tokens, password hashes) into whatever collects the container's output.

## 8. Destructive Operations

Before running anything containing `DROP`, `TRUNCATE`, `ALTER`, or an `UPDATE`/`DELETE` without a
`WHERE`, stop and confirm with the user. For a complex update, show the matching `SELECT` first so the
affected rows are visible before they change.
