---
paths:
  - "src/middleware/auth.middleware.ts"
  - "src/shared/abstracts/policy.abstract.ts"
  - "src/features/**/*.policy.ts"
  - "src/features/account/**/*.ts"
  - "src/features/user-permission/**/*.ts"
  - "src/shared/types/express.d.ts"
  - "src/shared/types/user-role.type.ts"
  - "src/helpers/security.helper.ts"
  - "src/config/rate-limit.config.ts"
  - "src/config/rate-limit.store.ts"
---

# Authentication & Authorization Protocol

**Scope:** Token issuance/verification, `res.locals.auth`, permission checks, password handling, social login.

## 1. Core Philosophy

- **Authentication and authorization are separate layers.** `authMiddleware` (runs on every request) answers "who is this?" and always populates `res.locals.auth` - never leaves it `undefined`. `PolicyAbstract` subclasses answer "are they allowed to do this?" and are called explicitly, by the controller, per action.
- **Every controller action starts with a policy check.** `this.policy.canX(res.locals.auth)` (or `.requiredAuth(...)` / `.notAuth(...)`) is the first line of every action - see `api.md` §4. Never infer authorization from the presence of `res.locals.auth.id` directly in a controller/service.
- **Admins bypass permission checks, not authentication checks.** Every `canX` method in `PolicyAbstract` still calls `requiredAuth()` first; only the granular permission lookup is skipped for admins.

## 2. Token Model

Auth tokens are a **hybrid**: a signed JWT carries the identity, but a DB row is the source of truth for validity/revocation.

- `AccountTokenService.generateAuthToken()` creates a random `ident` (uuid) and signs `{ user_id, ident }` with `jwt.sign(..., Configuration.get('user.authSecret'))`. The DB (`account_token` table, `AccountTokenEntity`) stores `ident`, `user_id`, `expire_at`, `used_at`, and a `metadata` fingerprint (user-agent, via `tokenMetaData(req)`).
- Verifying a request: extract the bearer token (`accountTokenService.getAuthTokenFromHeaders(req)` - `Authorization: Bearer <token>`), `jwt.verify` it, then look up the `ident` row in `account_token` - a syntactically valid JWT whose `ident` row is missing/expired is **not** a valid session. This is what makes token revocation possible (`removeAccountTokenByIdent`, `removeAccountTokenForUser`) even though JWTs themselves can't be revoked.
- Token metadata is checked against the current request's user-agent (`compareMetaDataValue`) in production only - a mismatch fails auth silently (falls back to visitor), it does not throw.
- Near-expiry tokens are **silently refreshed** by `accountTokenService.touchSession()`, called from `authMiddleware` (extends `expire_at` when remaining time drops below `user.authRefreshExpiresIn`) - don't reimplement token refresh elsewhere. `used_at` is written at most once per `user.authTouchInterval` (60s), so a busy session does not write its row on every request; the extension is never deferred.

### 2.1. Auth lookups are cached

`authMiddleware` does no database work on a warm signed-in request. Both lookups go through `cacheProvider` with the default `cache.ttl` (`CACHE_TTL=0` turns them off):

| Key | Holds | Dropped by |
|---|---|---|
| `account_token:<ident>` | the session row (`AuthSession`), read by `findSessionByToken` | `removeAccountTokenByIdent`, `removeAccountTokenForUser`, the middleware's `discardSession` - all through `forgetSessions(idents)` |
| `user:<id>:auth` | the user context, password reduced to `has_password` | `cleanEntityCache(UserEntity, id)` - every `userService` write, the repository's delete/restore, permission changes |
| `user:<id>:permissions` | `{ entity: [operations] }` | same as above |

- **Any new code that deletes `account_token` rows must call `accountTokenService.forgetSessions(idents)`**, or a revoked token keeps working until the TTL runs out. Select the idents before the delete - the repository's `delete()` returns ids only. `AccountTokenEntity.HAS_CACHE` stays `false`: the repository's id-keyed `cleanCache` cannot reach ident-keyed entries.
- **Any new write to the `user` table must end in `cleanEntityCache(UserEntity, id)`** (`userService.update()` already does), or role/status/name changes lag the TTL - a deactivated user keeps signing in.
- The cache returns dates as ISO strings. `findSessionByToken` revives `used_at`/`expire_at`; the user context's dates stay strings, which is what `meDetails` serializes anyway.
- Never put the password hash into the cached user context - `meDetails` sends `res.locals.auth` verbatim, and Redis is not where hashes belong.
- `jsonwebtoken` is used in exactly two places: `account-token.service.ts` (session tokens) and `account.service.ts` (email confirmation tokens, a separate short-lived JWT unrelated to sessions). Don't introduce a third JWT flow without a reason - prefer the existing `account-token` mechanism for anything session-like.

## 3. `res.locals.auth`

Always present, shaped as `AuthContext` in `src/shared/types/express.d.ts` - read the fields there. `id` is `0` for an unauthenticated "visitor", and `role` widens the `UserRole` union with `'visitor'`.

- Permissions are `{ entity: [operations] }` pairs (`create`/`read`/`update`/`delete`/`find`, matching `PolicyAbstract`'s `canX` methods), loaded from `user-permission` and cached per user via `cacheProvider`.
- `operator_type` only carries meaning when `role` is `operator`; it is `null` for every other role.

## 4. Policy Layer

Every feature that needs authorization has a `<feature>.policy.ts` - a bare `extends PolicyAbstract` passing `<Entity>.NAME` to `super()`, exporting a singleton.

`PolicyAbstract` (`src/shared/abstracts/policy.abstract.ts`) provides, keyed to the entity name passed to the constructor:

- `requiredAuth(auth)` / `notAuth(auth)` - throw `UnauthorizedError`/`NotAllowedError` for auth-gated vs. auth-forbidden actions (e.g. `login` must be `notAuth`).
- `canCreate` / `canRead` / `canUpdate` / `canDelete` / `canFind` (`canRestore` aliases `canDelete`) - `requiredAuth` + admin bypass + `hasPermission(auth, entity, operation)`, throwing `NotAllowedError` on failure.
- `allowDeleted(auth)` - true for admins or anyone with `delete` permission on the entity; pass this into repository/service calls that decide whether to include soft-deleted rows.
- `getId(auth)` / `getRole(auth)` / `getPermissions(auth)` - read accessors; use these instead of reaching into `auth.id` etc. directly so behavior stays centralized.

Only add methods to a feature's own `<feature>.policy.ts` for checks that don't generalize (e.g. ownership rules specific to that entity); generic CRUD authorization stays in `PolicyAbstract`.

## 5. Passwords

- Both bcrypt calls live in `src/helpers/security.helper.ts`: hash with `encryptPassword()` (`bcrypt.hash(password, 10)`), compare with `comparePassword()` (`bcrypt.compare`). Never call bcrypt anywhere else.
- `AccountService.checkPassword()` delegates to `comparePassword()` and stays the entry point for **account** credentials - account flows should keep calling it. Reach for the helper directly only for a hashed secret that is not a user password, such as an article's shared access password (`ArticleAccessPolicy`); that is why the comparison is a helper rather than a method on the account service.
- Never return or log a raw password. The response envelope already redacts `password`/`password_confirm`/`password_new`/`password_current` from the echoed request body (`api.md` §2) - don't add a second redaction layer, but also don't bypass it by putting password data somewhere else in the response (e.g. `meta`).
- `accountService.updatePassword(...)` is expected to also invalidate existing sessions where relevant (see `passwordRecoverChange`/`passwordUpdate` in `account.controller.ts`, which issue a fresh token after a password change) - a new password-changing flow should follow the same pattern rather than leaving old tokens valid.

## 6. Rate Limiting

`src/config/rate-limit.config.ts` defines three limiter types: `api` (the default) plus the stricter `authLogin` and `authDefault` - read the current numbers there.

- **Counters live in Redis** (`RedisRateLimitStore`, `src/config/rate-limit.store.ts`, keys `rate_limit:<type>:<key>`), so every API replica shares one budget. One store instance per limiter - `express-rate-limit` refuses a shared one. The script is sent with plain `EVAL` per hit on purpose: a startup `SCRIPT LOAD` (as `rate-limit-redis` does) stays rejected if Redis is down at boot and switches limiting off until a restart.
- **`passOnStoreError: true`** - a Redis outage lets requests through instead of answering 500.
- **Each limiter has a `scope`.** `api` is `user`: a signed-in caller is counted by account, a visitor by IP (`ipKeyGenerator`, required by `express-rate-limit` v8 for IPv6). The credential limiters are `ip`. `authMiddleware` runs before every route, so `res.locals.auth` is settled when the key is built.
- `describeRateLimit()` derives the docs text from `configs` - change a limit there, not in the docs.

### 6.1. Auth routes
 Auth-sensitive routes attach the stricter limiter explicitly in their `*.routes.ts` `handlers` array - see `account.routes.ts` (`authLoginRateLimiter` on `/login`, `authDefaultRateLimiter` on `/register`, `/password-recover`, `/email-confirm-send`). Any new credential-guessing-prone endpoint (login, recovery, token issuance) should do the same rather than relying on the default `apiRateLimiter`.

## 7. Social Login (OAuth)

The browser leg (provider redirect, `state` cookie, callback page) belongs entirely to the frontend
(`nready-ui`, not built yet - `star-ui`'s CLAUDE.md "Social login (OAuth)" is the reference). This
API only ever sees an authorization **code**, posted to it.

- **Three routes**, all on `account.routes.ts`: `POST /account/oauth/:provider` (`oauthLogin` - exchange
  the code, issue a session), `GET /account/oauth` (`oauthList`), `DELETE /account/oauth/:provider`
  (`oauthUnlink`). `oauthLogin` carries `authLoginRateLimiter` and `policy.notAuth()` - it is a login,
  so it is limited and gated like one.
- **Sign-up and sign-in are the same endpoint.** The provider cannot tell them apart and neither can the
  user's intent be inferred from the code; don't split them.
- **The code is exchanged server-side.** `account-oauth.client.ts` holds the client secret and talks to
  the provider; nothing about the exchange belongs in a response. `resolveOAuthProfile` is injected into
  `AccountOAuthService` (constructor arg, not an import) so tests substitute it instead of calling Google.
- **`redirect_uri` is forwarded verbatim and validated here.** The provider matches it against the URI
  that obtained the code, so it must arrive from the client - `assertAllowedRedirectUri` accepts anything
  under `frontend.url` plus `oauth.redirectUriAllowList` (`OAUTH_REDIRECT_URI_ALLOW_LIST`, comma-separated
  extra origins for preview deployments / a second frontend a single backend may serve). Defence in depth
  behind the provider's own registered-URI list; keep it.

### 7.1. Identity resolution (`AccountOAuthService.resolveUser`)

Order matters - it is the account-takeover surface:

1. Known `(provider, provider_user_id)` → that user. **The subject id is authoritative; the email is
   not** and is only refreshed on the row for auditing.
2. No identity, no email from the provider → 400 `oauth_email_missing`.
3. No identity, **unverified** provider email → 400 `oauth_email_unverified`. Never match an existing
   account on an address the provider's own user never proved. Google's is `email_verified` from the id
   token; Facebook Graph has no such field, so `email_verified: !!profile.email` encodes "an address only
   reaches the Graph after Facebook confirms it" - if you add a provider, decide this explicitly.
4. Verified email, no such user → create passwordless (`createUserFromProfile`: `status: ACTIVE`,
   `email_verified_at` stamped, name falls back to the address's local part). The provider established
   what the confirmation mail would have, so no confirmation is sent.
5. Verified email, existing user → `assertUserCanLogin` (soft-deleted → 404, `INACTIVE` → 404), a
   `PENDING` account is activated, then the identity is linked.

`account_identity` (`system` schema, no `deleted_at`) carries two unique indexes: `(provider,
provider_user_id)` and `(user_id, provider)`. Unlink is therefore a **hard** delete - a soft-deleted row
would hold the index and block ever re-linking that provider.

### 7.2. Passwordless accounts

`user.password` is nullable now, and it is `select: false`, so `findById` leaves it `undefined` -
**a check against `user.password` needs `userService.findByIdWithPassword(id)`** or it silently compares
against nothing. Every flow that assumes a password must handle its absence:

- `login` → 400 `oauth_only_account` before `checkPassword` (otherwise the user is sent to reset a
  password that does not exist).
- `passwordUpdate` → 400 `oauth_only_account`; setting a first password goes through password recovery,
  which proves ownership by email instead.
- `meDelete` → skips the password confirmation; the valid auth token is the same bar as every other `/me`.
- `unlink` → 409 `oauth_unlink_last_credential` when the account has no password and this is its last
  identity, i.e. removing the only way in.
- `res.locals.auth.has_password` (`authMiddleware`) exposes this to the frontend - `password_updated_at`
  is stamped at creation regardless, so it never reads as "no password". The middleware destructures
  `password` out before the spread; `meDetails` serialises the whole auth object, so leaving it in would
  publish the hash.

### 7.3. Configuration and status codes

`Configuration.get('oauth.*')`: per-provider `clientId`/`clientSecret` (`OAUTH_GOOGLE_*`,
`OAUTH_FACEBOOK_*`) plus `oauth.facebook.apiVersion` (Graph versions are retired on a schedule, hence
configurable). A provider with no credentials answers **501** `oauth_provider_not_configured` - the
request was well-formed, the deployment simply does not offer it; the frontend hides a provider whose
`NEXT_PUBLIC_OAUTH_*_CLIENT_ID` is unset, so the two configs have to agree. A provider that fails or
answers unexpectedly is **502** `oauth_provider_error`. Both codes were added to `HttpStatusCode` for
this flow - don't collapse them into 400/500.

Adding a provider: `AccountIdentityProviderEnum` entry, a `settings.config.ts` block, an exchange branch
in `account-oauth.client.ts` (including its `email_verified` decision), and locale messages. `nready-ui`
hides any provider whose `NEXT_PUBLIC_OAUTH_*_CLIENT_ID` is unset, so the two configurations have to
agree - add the frontend entries in the same change once that repo exists.

## 8. Testing

`authMiddleware` is disabled entirely when `Configuration.isEnvironment('test')` (`src/app.ts`). Controller tests never exercise real token verification - they spy on the policy instance instead (`notAuthenticatedSpy` / `isAuthenticatedSpy` / `notAuthorizedSpy` / `authorizedSpy` from `@/tests/mocks/policies.mock`). See `testing.md`.
