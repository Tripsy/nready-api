# NReady

![Node.js](https://img.shields.io/badge/Node.js-24-green)
![Express](https://img.shields.io/badge/Express-5.2-black)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791)
![Docker](https://img.shields.io/badge/Docker-ready-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Redis](https://img.shields.io/badge/Redis-integrated-red)
![JWT](https://img.shields.io/badge/JWT-auth-orange)
![Zod](https://img.shields.io/badge/Zod-validation-3E6B9B)

# 📄 Description

NReady is a **Node.js - Express / TypeScript** boilerplate designed for complex, secure REST APIs.

This boilerplate can serve as a foundation to quickly build MVPs, CMS platforms, CRMs and E-commerce solutions.

It comes with a [solid structure](#-structure), it is fully modular and feature-based, and already contains a lot of useful [features](#-features),
and many [goodies](#-characteristics) including:
- **Complete authentication system** - JWT access / refresh tokens, email confirmation, password recovery, session limits, social sign-in (Google, Facebook);
- **A working commerce chain** - catalog, cart, checkout, orders, discounts, shipping, typed invoices with reversals, payments allocated FIFO per client, and a client ledger;
- Convention-based auto-discovery - drop in a `*.routes.ts`, `*.cron.ts`, `*.listener.ts` or `*.bootstrap.ts` and it is wired at startup;
- Hook slots between features - a feature plugs into another from its bootstrap without being imported by it, so an optional feature stays removable;
- A feature installer (`cli/feature.ts`) with version-aware dependency resolution, so a slice can be packaged and moved between projects;
- Background processing - BullMQ queues, an email worker, and a cron provider that records every run and takes a Redis lock per job;
- Built to run as several replicas - sessions cached in Redis, rate limits shared through it, crons and the worker split into a dedicated [scheduler](#-deployment);
- A generated API reference, served per feature from the `*.docs.ts` files;
- Advanced logging and error handling, with a destination per level (console, file, database, email, CloudWatch);
- Custom middlewares;
- Multi-language support for content and outgoing email;
- Strong validation and policy-based authorization;
- Testsuite based on Jest and Supertest;
- Docker support;

The code follows **best practices** and **design principles** like SOLID, KISS, DRY, and strong security standards. 
The codebase is fully typed in **TypeScript**. **Biome** ensures code quality.

The database is **PostgreSQL**, using **TypeORM** as the ORM layer.
**Redis** backs both the cache and the queues.

A ready-to-use Docker environment is provided for quick [setup](#-setup).

This project is still a work in progress, and the next goals are:
   - Stock handling - goods receipts (`grn`) and warehouse movements are entity-only so far
   - Subscriptions - entity-only so far
   - Returns
   - Create documentation

The working list, with the design notes behind each item and the latest load-test figures, is in [TODO.md](TODO.md).

Meanwhile, we're open to suggestions / feedback, and if you find this project useful, please consider giving it a star ⭐

> On a [separate project](https://github.com/Tripsy/nready-ui), powered by **React / Next.js** you can find a 
> working #FrontEnd interface which demonstrates the usability of the `authentication system`, a storefront
> (catalog, cart, checkout, the buyer's orders and invoices) and an **Administration Dashboard** covering
> Users, Permissions, Templates, Logs, Clients, Cash-Flow, Places, Products, Orders, Invoices, Shipping, etc

# 🚀 Tech Stack

## Core
- Language: TypeScript 6.0
- Runtime: Node.js 24 (Active LTS)
- Framework: Express.js 5.2
- Package manager: pnpm

## Code Quality
- Linting, Formatting, Import Cycles: Biome
- Validation: Zod 4.4

## Security
- Authentication: JWT tokens, social sign-in (Google, Facebook)
- Client gate: `x-api-key` header checked against `CLIENT_API_KEYS`
- Password Hashing: bcrypt
- Headers Security: Helmet
- Cross-Origin: CORS
- Rate Limiting: express-rate-limit, counted in Redis so every replica shares one budget
- Input Validation: Zod 4.4
- HTML Sanitizing: sanitize-html

## Database
- PostgreSQL 18
- ORM: TypeORM
- Cache & Queues: Redis (ioredis, BullMQ)

## Logging
- Logger: Pino
- Destinations, selected per level: console, file, database, email, CloudWatch

## Infrastructure
- Containerization: Docker (development container, production image and compose stack)
- Email: SMTP (nodemailer) or AWS SES
- Testing: Jest, Supertest
- Load testing: k6 (`loadtest/`)
- CI: GitHub Actions

# ⚙ Characteristics

- [x] Ready-to-use boilerplate with a modular, feature-based architecture
- [x] Best Practices: Clean architecture, TypeScript, error handling, async patterns, DRY, SOLID, KISS
- [x] Security: Helmet, Redis-backed rate limiting, input validation, CORS, client API keys
- [x] Logging (powered by Pino)
- [x] Request validation (powered by Zod)
- [x] Standardized JSON Responses: Consistent response structures for better frontend integration
- [x] Caching (powered by ioredis)
- [x] Cron jobs provider with automatic discovery, registration, run history and a Redis lock per job
- [x] Auto-registered event listeners
- [x] Feature bootstrap files and typed hook slots (`<feature>.hooks.ts`, `shared/registries/`) for plugging one feature into another
- [x] Email sending via queues (powered by BullMQ)
- [x] Template management for emails and pages
- [x] Subscribers (powered by TypeORM)
- [x] Custom Middlewares
    - Auth (auth.middleware → res.locals.auth)
    - Client key (`x-api-key`)
    - Request context
    - Language
    - Query params validation, etc
    - API documentation displayed on error responses (development only)
    - API Output formatting
    - Params validation
- [x] Internationalization / language management (own `lang()` layer over per-feature `locales/*.json`)
- [x] Complete `Auth System`: Secure, modular auth layer supporting user registration, login (token-based authentication), social sign-in, etc.
- [x] Session and user context cached in Redis
- [x] Authorization policies based on user roles and permissions
- [x] Testing (powered by Jest & Supertest)
- [x] Documentation provided for APIs endpoints (`*.docs.ts`, served at `/public/api-docs` when `API_DOCS_ENABLED=true`)
- [x] Packaged features, installable via CLI with version-aware dependency resolution
- [x] Document numbering from one continuous series per document type (orders, invoices)
- [x] Demo seeds for every feature owning a table
- [x] Development environment available (Docker)
- [x] Production image and compose stack, with a one-shot migration step and a dedicated scheduler

# ✨ Features

### Core features

- [x] account
    - register, login, removeToken, logout, passwordRecover, passwordRecoverChange, passwordUpdate, emailConfirm, emailConfirmSend, emailUpdate
    - social sign-in (Google, Facebook) - oauthLogin, oauthList, oauthUnlink
    - me, sessions, edit, delete
- [x] api-docs
- [x] cron-history
- [x] log-data
- [x] log-history
- [x] mail-queue
- [x] permission
- [x] template
- [x] user
- [x] user-permission

### Modular features

- [x] address
- [x] article 
- [x] brand
- [x] carrier
- [x] cart
- [x] cash-flow
- [x] category
- [x] client
- [x] client-address
- [x] client-ledger
- [x] comment
- [x] complaint
- [x] discount
- [x] document-series
- [x] exchange-rate
- [ ] grn
- [x] image
- [x] invoice
- [x] order
- [x] order-settlement
- [x] place
- [x] product
- [x] rating
- [x] review
- [x] shipping
- [x] stats
- [ ] subscription
- [x] term
- [x] vendor
- [x] warehouse

Unchecked features hold their entities only - no routes, services or seeds yet.

### The commerce chain

`cart` → `order` → `invoice` → `cash-flow` → `client-ledger`, with `shipping` alongside:

- **cart** - a shopper's picks, priced at read time (discounts, shipping rate, checkout country)
- **order** - placed from the cart or by an operator; manual line and order-wide discounts, bundles and product options, buyer cancel
- **invoice** - raised when an order is confirmed; typed by scope (`order`, `shipping`, `subscription`, `custom`), full or partial reversals, a printable document for the buyer and the back office
- **cash-flow** - payments, spread over a client's open invoices oldest first
- **client-ledger** - what each client owes, reconciled by a cron
- **shipping** - delivery, return and relocation movements, prepared when the order is confirmed
- **order-settlement** - optional; moves an order's status as its invoices and deliveries settle. Without it billing runs the same and orders change status by hand

Each step announces itself through a hook the next one answers, so the dependencies run one way.

# 🛠 Setup

### 1. Add `hosts` record

Point `nready-api.test` at `127.0.0.1`:

```
sudo nano /private/etc/hosts
```

For configuration refer to this guide:  
[How to Edit the Host File on macOS](https://phoenixnap.com/kb/mac-hosts-file)

### 2. Initialize Docker container

The compose file joins an external network named `development`, shared with the frontend
container - create it once:

```
docker network create development
```

PostgreSQL and Redis are not part of this compose file. The container reaches them through
`host.docker.internal`, so run them wherever suits and point `DB_*` / `REDIS_*` at them.

Start the Docker container using the following command:

```
docker compose up
```

### 3. Connect to the Docker container
Once the container is running, connect to it with:

```
docker exec -it nready-api.test /bin/bash
```

### 4. Install dependencies inside the container
Run the following command to install project dependencies:

```
$ pnpm install
```

### 5. Update .env

Start by copying the `.env.example` file to `.env` and update the environment variables accordingly.
Every variable is commented there. The ones worth a look on a first run:

- `DB_*`, `REDIS_*` - the connections
- `CLIENT_API_KEYS` - the keys accepted in the `x-api-key` header of every request (`/health` and `/ready` excepted); must contain what the frontend sends. Empty disables the gate
- `AUTH_JWT_SECRET`, `EMAIL_JWT_SECRET`, `IP_HASH_SECRET` - placeholders by default
- `MAIL_*` - outgoing email
- `COMPANY_*`, `INVOICE_DUE_DAYS` - the seller details printed on invoices
- `SHIPPING_*` - the flat shipping rates
- `OAUTH_*` - social sign-in; a provider with an empty client id is disabled

### 6. Database

Create the database itself, then build the schema:

```
$ pnpx tsx src/database/migrate.ts
```

This creates the non-public schemas (`system`, `logs`) before applying the migrations, so it
works against an empty database. It is also the production entry point.

> **⚠ Warning**
> `pnpm run migration:run` drives the TypeORM CLI, which writes its `system.migrations`
> bookkeeping table *before* running any migration - on an empty database it fails with
> `schema "system" does not exist`. Use it only once the schemas exist, or create them by hand
> first:
>
> ```sql
> CREATE SCHEMA IF NOT EXISTS system;
> CREATE SCHEMA IF NOT EXISTS logs;
> ```

Then the reference data, the first administrator and, optionally, the demo data:

```
$ pnpx tsx src/features/template/database/template.seed.ts
$ pnpx tsx src/features/permission/database/permission.seed.ts
$ ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpx tsx src/features/account/database/admin.seed.ts
$ pnpm run seed
```

### 7. Run the application

```
$ pnpm run dev
```

`GET /health` answers once the server is up.

### 8. Setup features

```
$ pnpx tsx cli/feature.ts [feature] install
$ pnpx tsx cli/feature.ts [feature] remove
$ pnpx tsx cli/feature.ts [feature] upgrade
```

# 🚢 Deployment

Production runs one image (`docker/dockerfile.prod`) in three roles, wired up in
`docker-compose.prod.yml`:

| Service | Does | Replicas |
|---|---|---|
| `migrate` | Creates the schemas and applies pending migrations, then exits. The other two start only after it exits `0` | one-shot |
| `api` | Serves HTTP. `CRON_ENABLED=false`, `WORKER_ENABLED=false` | as many as needed |
| `scheduler` | Runs every cron job and the email queue worker. Answers `/health`, serves no traffic | exactly 1 |

Postgres and Redis are not part of the stack - point `DB_*` and `REDIS_*` at them.

### 1. Environment

```
$ cp .env.example .env.production
```

Set at least `APP_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `CLIENT_API_KEYS`, the `DB_*` / `REDIS_*`
connection, and every secret (`AUTH_JWT_SECRET`, `EMAIL_JWT_SECRET`, `IP_HASH_SECRET`). The defaults
of those secrets are placeholders. `APP_ENV`, `NODE_ENV`, `APP_PORT`, `CRON_ENABLED` and
`WORKER_ENABLED` are set by the compose file and override whatever this file says, so a copy of
`.env.example` (which says `development`) cannot switch off what `APP_ENV=production` turns on -
`trust proxy`, the session user-agent check, the warning for an empty `CLIENT_API_KEYS`.

### 2. Build and start

```
$ docker compose -f docker-compose.prod.yml up -d --build
```

On an empty database, create the database itself first - `migrate` creates the `system` and `logs`
schemas and everything inside them. Then, once, the reference data and the first administrator:

```
$ docker compose -f docker-compose.prod.yml run --rm api node src/features/template/database/template.seed.js
$ docker compose -f docker-compose.prod.yml run --rm api node src/features/permission/database/permission.seed.js
$ docker compose -f docker-compose.prod.yml run --rm -e ADMIN_EMAIL=... -e ADMIN_PASSWORD=... api node src/features/account/database/admin.seed.js
```

### 3. Scaling the API

```
$ API_REPLICAS=3 docker compose -f docker-compose.prod.yml up -d
```

A single published port binds one replica only: put a reverse proxy in front and drop the `ports`
mapping, or publish a range (`"3000-3002:3000"`) sized to the replica count.

### Why one scheduler

Every process with `CRON_ENABLED=true` schedules every job, so N API replicas would each run each job
N times - N overdue-invoice passes, N comment digests. Running the jobs in one dedicated process
keeps them off the request path too.

A misconfigured replica does not double a run. Each run takes a Redis lock keyed by the job's name,
so whichever process takes the lock runs the tick and the others skip it. The lock also stops a run
starting while the previous one is still going, on any instance. A lock left by a process that died
expires after the larger of 20x the job's `EXPECTED_RUN_TIME` and 5 minutes. The hourly
`cron-stuck-check` then closes that run's `running` row in `cron_history` as an error, and the daily
`cron-error-count` email reports it. With Redis unreachable, ticks are skipped rather than run
unguarded.

`cli/` is not compiled into the image. To run a job by hand, use `tsx cli/cron.ts run <name>` from a
checkout pointed at the same database and Redis. It takes the same lock; `--force` bypasses it.

# 🖥 Commands

> **⚠ Warning**
> Always check the migrations before run it, sometimes columns are dropped

> **⚠ Warning**
> A green test run can be a lie - read the test *count*, not just the color. `bail: 3` stops
> the run after 3 failing files, and a SIGKILLed worker drops a whole file while the summary
> still looks plausible. For a trustworthy full run:
>
> ```bash
> $ docker exec -e NODE_OPTIONS=--experimental-vm-modules -e APP_DEBUG=false \
>     -e APP_ENV=test -e NODE_ENV=test $DOCKER_CONTAINER pnpm exec jest --bail=0
> ```
>
> `pnpm run test -- --bail=0` does **not** work: the `--` reaches jest as a literal test-path
> pattern and matches nothing.

```bash
// Generate migration file
$ pnpm run migration:generate /var/www/html/src/database/migrations/init

// Apply pending migrations - this is the production entry point and the one to use on an
// empty database, since it creates the `system` and `logs` schemas first
$ pnpx tsx src/database/migrate.ts

// Run new migrations - update DB structure
// Goes through the TypeORM CLI, which writes its `system.migrations` table before running
// anything, so it fails on a database where the schemas do not exist yet
$ pnpm run migration:run

// Revert last migration
$ pnpm run migration:revert

// Replace every migration with a single one generated from the entities
// Pre-production only; --baseline rewrites the migrations table of a database whose schema
// already matches. Use `pnpm exec`, since `pnpm run ... --` forwards `--` literally
$ pnpm exec tsx ./cli/migration-consolidate.ts --baseline

// Reset database
$ pnpx tsx ./node_modules/typeorm/cli.js schema:drop -d src/config/data-source.config.ts

// Import reference data - a fixed canonical list, wipe-and-insert; run these first
$ pnpx tsx /var/www/html/src/features/template/database/template.seed.ts  
$ pnpx tsx /var/www/html/src/features/permission/database/permission.seed.ts

// Create the first administrator - reads ADMIN_EMAIL / ADMIN_PASSWORD, which have no
// defaults; keyed on email, so re-running never resets an existing admin's password
$ pnpx tsx /var/www/html/src/features/account/database/admin.seed.ts

// Import demo data - every entity in foreign-key order, or a single one
$ pnpm run seed
$ pnpm run seed brand

// Run tests
$ pnpm run test
$ pnpm run test account-controller.test.ts
$ pnpm run test src/features/account --detectOpenHandles

// Code sanity (lint, format, circular dependencies)
$ pnpm run biome

// Type check without emitting
$ pnpm run typecheck

// Fail on any lang() key with no locale entry
$ pnpm run messages:check

// Fail on a broken feature manifest graph - missing or unsatisfiable depends_on,
// dependency cycles, stale required_by
$ pnpm run manifests:check

// Production build (-> dist/src) and run it
$ pnpm run build
$ pnpm run start

// CLI
$ pnpx tsx cli/cron.ts list -s  
$ pnpx tsx cli/cron.ts run cron-time-check

// Load test. Mint a session for an existing user first (inside the container) - the JWT is
// written to logs/loadtest/token.jwt, never printed
$ pnpm exec tsx loadtest/mint-token.ts <user_id>

// Then, from the host: offer <rate> req/s for <duration>. k6 runs in its own container on
// the `development` network; an optional third argument costs a single route. Summaries
// land in logs/loadtest/
$ loadtest/run.sh 200 30s
$ loadtest/run.sh 200 30s /account/me
```

# 📁 Structure

```
├── .github/workflows/     # CI
├── cli/                   # Feature installer, cron runner, manifest / message checks, migration consolidate
├── docker/                # Development and production dockerfiles
├── loadtest/              # k6 scenario and its runner
├── src/
│   ├── config/            # Settings, Redis / queue init, rate limiting, auto-discovery setup
│   ├── database/
│   │   ├── migrations/    # TypeORM migrations
│   │   ├── seed/          # Demo seed runner
│   │   └── migrate.ts     # Creates the schemas, applies pending migrations
│   ├── exceptions/        # Custom error classes
│   ├── features/          # Feature-based modules
│   │   ├── invoice/
│   │   │   ├── cron-jobs/
│   │   │   │   └── invoice-overdue.cron.ts
│   │   │   ├── database/
│   │   │   │   └── invoice.seed.ts
│   │   │   ├── locales/
│   │   │   │   └── en.json
│   │   │   ├── tests/
│   │   │   ├── manifest.json            # Version, entities, depends_on / required_by
│   │   │   ├── invoice.bootstrap.ts     # Registers into the hook slots of other features
│   │   │   ├── invoice.controller.ts
│   │   │   ├── invoice.docs.ts          # API reference
│   │   │   ├── invoice.entity.ts
│   │   │   ├── invoice.hooks.ts         # Hook slots this feature raises
│   │   │   ├── invoice.mock.ts
│   │   │   ├── invoice.policy.ts
│   │   │   ├── invoice.repository.ts
│   │   │   ├── invoice.routes.ts
│   │   │   ├── invoice.service.ts
│   │   │   ├── invoice.subscriber.ts
│   │   │   ├── invoice.validator.ts
│   │   │   └── invoice-public.*.ts      # Buyer-facing controller, routes and docs
│   │   └── ...            # Other features (user, category, etc.)
│   ├── helpers/           # Utilities (date, string, object, hooks, etc.)
│   ├── middleware/        # Custom Express middlewares
│   ├── providers/         # Infrastructure (DB, cache, lock, logger, email, cron)
│   ├── queues/            # BullMQ queues
│   ├── shared/
│   │   ├── abstracts/     # Base / abstract classes
│   │   ├── cron-jobs/     # System cron-jobs
│   │   ├── locales/       # Shared language
│   │   ├── registries/    # Polymorphic hook slots no single feature owns
│   │   ├── transformers/  # Shared transformers
│   │   └── types/         # Shared types
│   ├── templates/         # Email layout templates
│   ├── tests/             # Jest setup, shared mocks, cross-feature tests
│   ├── workers/           # Background workers
│   ├── app.ts
│   ├── bootstrap.ts
│   └── server.ts
├── .env.example
├── .gitignore
├── biome.json
├── docker-compose.yml
├── docker-compose.prod.yml
├── jest.config.js
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── TODO.md
├── tsconfig.build.json
└── tsconfig.json
```

# 🔗 Dependencies

### Runtime

- [express](https://expressjs.com/) - Web framework
- [TypeORM](https://github.com/typeorm/typeorm) - ORM for TypeScript and JavaScript with support for multiple databases
- [pg](https://github.com/brianc/node-postgres) - PostgreSQL client
- [ioredis](https://github.com/redis/ioredis) - Robust Redis client, backing both the cache and the queues
- [BullMQ](https://docs.bullmq.io/) - Redis-based message queue
- [zod](https://zod.dev) - TypeScript-first schema validation with static type inference
- [Pino](https://github.com/pinojs/pino) - Fast, low-overhead logger, with `pino-abstract-transport` and `pino-pretty`
- [helmet](https://helmetjs.github.io/) - Security middleware for Express
- [express-rate-limit](https://express-rate-limit.mintlify.app/overview) - Rate limiting middleware for Express, with a Redis store of our own behind it
- [cors](https://github.com/expressjs/cors) - Cross-origin resource sharing
- [compression](https://github.com/expressjs/compression) - Response compression
- [cookie-parser](https://github.com/expressjs/cookie-parser) - Cookie parsing
- [qs](https://github.com/ljharb/qs) - Query string parsing, for nested filter params
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken) - JSON Web Token implementation
- [bcrypt](https://github.com/kelektiv/node.bcrypt.js) - Password hashing
- [sanitize-html](https://github.com/apostrophecms/sanitize-html) - Strips untrusted HTML out of user-submitted content
- [nodemailer](https://nodemailer.com/) - Email sending over SMTP
- [@aws-sdk/client-ses](https://github.com/aws/aws-sdk-js-v3) - The alternative email transport
- [@aws-sdk/client-cloudwatch-logs](https://github.com/aws/aws-sdk-js-v3) - The remote log destination
- [@aws-sdk/credential-provider-node](https://github.com/aws/aws-sdk-js-v3) - Resolves the AWS credentials both clients use
- [nunjucks](https://github.com/mozilla/nunjucks) - Templating engine, for emails and pages
- [node-cron](https://github.com/node-cron/node-cron) - Task scheduler
- [file-stream-rotator](https://github.com/rogerc/file-stream-rotator) - Rotates the log files
- [dayjs](https://day.js.org/) - Parses, validates, manipulates, and displays dates and times
- [uuid](https://github.com/uuidjs/uuid) - Identifier generation
- [dotenv](https://github.com/motdotla/dotenv) - Loads `.env` in development
- [reflect-metadata](https://github.com/rbuckton/reflect-metadata) - Required by TypeORM's decorators

### Dev only

- [typescript](https://www.typescriptlang.org/)
- [tsx](https://github.com/privatenumber/tsx) - Runs the TypeScript entry points and CLI scripts directly
- [nodemon](https://nodemon.io/) - Restarts the dev server on change
- [jest](https://jestjs.io/) - JavaScript testing framework
- [ts-jest](https://kulshekhar.github.io/ts-jest/) - TypeScript preprocessor for Jest
- [supertest](https://www.npmjs.com/package/supertest) - HTTP assertion library for testing Node.js servers
- [node-mocks-http](https://github.com/eugef/node-mocks-http) - Mock `req` / `res` objects for unit tests
- [mailtrap](https://github.com/mailtrap/mailtrap-nodejs) - Mailtrap client, for inspecting outgoing email
- [commander](https://github.com/tj/commander.js) - Argument parsing for the `cli/` scripts
- [tsc-alias](https://github.com/justkey007/tsc-alias) - Rewrites the `@/*` alias to relative paths in the build output
- [biome](https://biomejs.dev/) - Fast formatter and linter for JavaScript, TypeScript, JSX, TSX, JSON, HTML, CSS and GraphQL
