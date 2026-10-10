---
paths:
  - "src/features/**/*.controller.ts"
  - "src/features/**/*.routes.ts"
  - "src/features/**/*.entity.ts"
  - "src/features/**/*.enum.ts"
---

# nready-ui Contract Protocol

`../nready-ui` (available via `permissions.additionalDirectories`) is this project's frontend - a
Next.js 16 app. The two connect purely over HTTP, so the API contract is the whole coupling:

- When `src/features/**/*.controller.ts` or `src/features/**/*.routes.ts` changes, state which
  `nready-ui` service (`src/services/*.service.ts`) needs the matching update, and make the change
  there too.
- Enums are mirrored by hand on both sides. `nready-ui`'s `src/models/permission.model.ts`
  (`PermissionEntityType`), `log-history.model.ts` (`LogHistoryEntities`, backend *table* names) and
  the per-entity model enums track this project's entities - when an entity, status, role or
  category enum changes here, say so and update the matching model there.
- Response shape is the envelope (`res.locals.output`, see `api.md`); dates are ISO 8601 strings;
  protected routes need `Authorization: Bearer {accessToken}`.
- Frontend conventions live in that repo's own `.claude/rules/` (`forms.md`, `data-fetching.md`,
  `state.md`, `typescript.md`) - consult those rather than inferring frontend rules from this
  project.
