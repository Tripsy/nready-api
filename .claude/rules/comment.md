---
paths:
  - "src/features/comment/**"
  - "src/features/complaint/**"
  - "src/config/event.config.ts"
  - "src/shared/registries/target-participation.registry.ts"
---

# Comment & Complaint Protocol

**Scope:** The reader-facing discussion (`comment`) and the reports filed against it or against an
article (`complaint`) - status model, who may write what, and the one automatic moderation
decision in the system. Entity/repository conventions are in `database.md`, route and controller
shape in `api.md`; this file covers only what those cannot express.

## 1. Two Audiences, Two Controllers

Both features ship a `*-public.controller.ts` beside the dashboard one, and the split is a
permission boundary, not a convenience:

| | `comment` | `complaint` |
|---|---|---|
| Public write | Guests and members alike | **Members only** - `user_id` is `NOT NULL`, so every public endpoint answers 401 without a session |
| Addressed by | The row id (`/:id`) - one author holds many comments on one target | The target (`/:entity_type/:entity_id`) - `UQ_complaint_user` allows one live complaint per reporter per target, so the path plus the caller names exactly one row |
| Ownership check | `CommentQuery.filterByOwner` narrows to the caller's rows | a `user_id` filter on the same query, so the row a public write resolves to is one the caller may write by construction |

An anonymous accusation is one nobody can be asked about, which is why complaints have no guest
path and no address hash. Comments do: `CHK_comment_author` requires either a `user_id` or a
guest name **and** address, and `user_ip_hash` is what a guest's later edit or withdrawal is
matched by.

`is_staff` is resolved from the caller's role and never from the body - it is a badge the comment
is rendered with, so a visitor setting it would be claiming to speak for the site.

## 2. Comment Status

`pending → rejected | spam | approved`, `approved → flagged | rejected | spam`, and every terminal
state can return to `approved` (`STATUS_TRANSITIONS` in `comment.entity.ts` is authoritative -
read it rather than restating it). Only `approved` is public.

**A member's comment lands `approved`; a guest's always lands `pending`.** The setting
(`isCommentAutoApproved()` in `comment.service.ts`, env `COMMENT_AUTO_APPROVE`, default true)
governs the member half only - turning it off puts members back in the queue too, and there is no setting that publishes a guest's
comment unread.

An account is the line because an account is what can be held to something: it can be suspended, it
carries an address somebody confirmed, and the auto-flag in §3 counts identifiable reporters for the
same reason. A guest is an address hash and a name they typed. For members, moderation is reactive -
a comment can be rejected afterwards, and three separate reports take one down on their own - which
is a trade worth making only when there is somebody to hold responsible.

The two things that follow from a comment being *visible* therefore happen in `create`, not only in
`updateStatus`: the parent's `reply_count` moves in the same transaction as the insert, and the
thread cache is dropped. Both are skipped for a comment that lands `pending` - every guest comment,
and every comment at all when the setting is off: it changes no public read, and counting it would
advertise a reply nobody can open. Either way the moderation trail stays empty on create - nobody
decided it, the setting did.

The response message follows the row rather than the setting (`success.create_public` vs
`success.create`): telling somebody their comment awaits moderation when it is already on the page
is the one thing that response exists to get right.

- Move a status **only** through `CommentService.updateStatus`. It asserts the transition, writes
  the moderation trail (`moderated_at` / `moderated_by` / `moderation_reason`) in the same save,
  moves the parent's `reply_count` when the `approved` boundary is crossed, and drops the thread
  cache. A direct `repository.save({ status })` skips all four.
- `reply_count` tracks what a reader can **open**, not what exists - so it follows visibility.
  `rejected → spam` crosses nothing and must not touch it.
- `moderation_reason` describes the state the comment is in *now*; it is overwritten on each
  decision, never appended to. The history of how it got there is `log_history`'s job.
- **`moderated_by: null` means nobody decided** - a background sweep or the threshold in §3 did.
  The column is nullable for exactly that, so never invent a user id to fill it.

### What the author may still change

`CommentService.OWNER_EDITABLE_STATUSES` - `pending` and `approved`. Anything a moderator decided
(`rejected`, `spam`, `flagged`) is refused with `error.not_editable`: that text is the record a
decision was taken against.

`approved` is in the list because it has to be. With `COMMENT_AUTO_APPROVE` on - the default - a
member's comment lands there the instant it is written, so a rule of "pending only" means no member
can ever correct a typo. The trade is that an approved comment can be rewritten into something no
moderator passed; `edited_at` is what makes that visible, and reactive moderation applies to the new
text exactly as it did to the old.

**`edited_at` is not `updated_at`.** `updated_at` moves for every save on the row - a status
decision, a pin - so reading it as "edited" marks comments whose author never went back to them.
`edited_at` is written only where `content` actually changes, on both edit paths, and the frontend
renders the marker from it.

**The author's edit drops the thread cache when the comment is approved**, and only then - a pending
row changes no public read. This is the one public write that did not have to clean before the rule
above widened; §7 is why it does now.

Withdrawal is unrestricted by status and takes the subtree with it (§5) - a member deleting their
own root comment removes the replies others wrote under it, the same cascade the dashboard delete
performs.

## 3. Automatic Flagging - the one decision nobody takes

An approved comment leaves the thread on its own once **three separate people** have live
complaints against it (`COMMENT_FLAG_REPORTER_THRESHOLD` in `comment.service.ts`).

Three rather than one: a single report is as often a disagreement as a problem, and acting on it
would hand any reader a mute button for anybody they argue with.

**What counts as a separate person** (`ComplaintQuery.countDistinctReporters`) - the rule, not the
implementation, is what matters here:

- `COUNT(DISTINCT LOWER(reporter.email))`, so two accounts sharing a mailbox are one person and
  one person filing several ways is still one.
- `INNER JOIN` on the reporter with `deleted_at IS NULL` and a non-empty address: a complaint whose
  author cannot be identified counts for nothing.
- Withdrawn complaints are out - the builder excludes soft-deleted rows unless asked otherwise.

**The wiring, and why it runs that way round:**

1. `ComplaintService.create` counts, then emits `complaintFiled` (`{ entity_type, entity_id,
   reporters }`). The count travels **in the payload**: counting is a question about the
   `complaint` table, and the feature owning the target has no business reading it.
2. `comment.listener.ts` picks the event up for its own table and calls
   `CommentService.flagWhenReported`, in `runInBackground` - a failed flag logs instead of
   rejecting into `server.ts`'s `unhandledRejection` handler, which would shut the API down. The
   complaints are already stored and queued, so nothing is lost.
3. The rule - the threshold, and `approved`-only - lives in the **comment** feature. What a count
   of reports means is the target's business; `complaint` only knows how to count.

Adding a new flaggable target means a listener in *that* feature, not a branch in `complaint`.

**It only ever goes one way.** Only a filing announces: an amendment changes what a complaint says
rather than who stands behind it, and a withdrawal or a restore would unmake a decision a moderator
may already have acted on. Nothing un-flags automatically - a moderator returns the comment to
`approved` from the dashboard.

## 4. Subscriptions and the Four-Hourly Digest

Commenting subscribes the author to the discussion. `CommentService.create` emits `commentPosted`,
`comment.listener.ts` records the subscription, and the defaults are deliberate:

- **On submission, not on approval.** Following a discussion is the author's intent whatever a
  moderator later decides about their comment.
- **`all` by default** - the row is what the reader then narrows or turns off.
- **Insert-or-ignore** against `UQ_comment_subscription_user`. `unsubscribed` is a *state*, not an
  absent row: somebody who opted out and commented again keeps their choice, and a second comment
  never rotates an existing token.
- **`user_email` is lower-cased on write.** The unique compares it byte-for-byte and a decorator
  cannot declare the `lower(user_email)` expression index that would hold the rule in the schema.
- A member's name and address are read from their **account** at send time, never from the comment
  row - the comment carries only `user_id`, and the address has to be the current one.
- **`language` is stored and refreshed.** It comes from `requestContext` (the request language the
  middleware put there), travels on the `commentPosted` payload - the listener runs after the
  response and the digest from a cron, neither of which has a request - and is the **only** column
  the conflict path updates. Everything else about an existing row is the subscriber's own doing:
  their `notification_type`, and their token, which is live in every notification already sent. The
  language is not a choice they made on that row; it is where they are reading.

The notification itself is a **digest**, run by `notify-comment-subscribers.cron.ts` every four
hours (`0 */4 * * *`), and this is the half that follows **approval**: a pending comment is not
public, and announcing it would leak what a moderator has not passed.

- `comment.notified_at` is the queue. Null and `approved` means outstanding; the run stamps every
  comment it processed, **including ones nobody was written about**, or a discussion with no
  subscribers is re-scanned forever.
- Sent in the **subscriber's** language, which is why it is stored: a guest has no account to read
  one from and the run has no request behind it. `comment-notification` (seeded from
  `comment/database/comment.templates.ts`) ships in `en` and `ro` - the only template with a second
  language, because it is the only one addressed to a reader whose language the system actually
  knows. A language with no template of its own still delivers:
  `loadEmailTemplate` falls back and warns, which is the content gap someone should close.
- One email per subscriber per run, never one per comment. A busy afternoon costs a subscriber one
  message; the price is up to four hours of lag, which is the right way round for a discussion
  nobody is watching live.
- Fan-out rules: nobody hears about their **own** comment (matched on the lower-cased address);
  `all` gets everything on the target; `replies_to_me` gets only comments whose **parent's** author
  is that subscriber, so a root comment never qualifies.
- `BATCH_LIMIT` caps a run; the remainder waits for the next one.

**Retention.** `clean-comment-subscription.cron.ts` runs daily (`37 04 * * *`) and hard-deletes
subscriptions older than 60 days - nothing else bounds the table, since a row is written for every
person who comments anywhere and only a hard-deleted target clears one. Two things about it:

- **`unsubscribed` rows are purged too, and the window is what makes that safe.** Everywhere else
  the opt-out *is* the row (§4) - `subscribe()` is insert-or-update so a later comment cannot
  re-subscribe somebody who asked to be left alone. The purge gives that up on purpose: after 60
  days of silence the discussion is over for that reader, and a comment they write on it after
  that is fresh intent rather than the old opt-out being overridden. **Shortening the window
  breaks that reasoning** - at, say, a week, the cron becomes a delayed re-subscribe for anyone
  who opted out of a live discussion.
- **The window runs from `created_at` and is not extended by later comments** - the conflict path
  updates `language` and nothing else. Somebody still following a two-month-old discussion is
  re-subscribed at `all` by their next comment.

**The digest links a comment by id, never by URL.** Each entry carries
`{{ siteUrl }}/comments/{{ comment.id }}`, which the frontend resolves to the page the comment sits
on when the link is followed. The address is deliberately *not* stored - not on the comment, not on
the subscription:

- A link in an inbox outlives the address it pointed at. An article can be re-slugged or re-filed
  under another category, and a stored URL is wrong from that moment on while an id never is.
- The slug is per language and per article *content* row; one comment would need a URL per language.
- It would duplicate, on every comment, what `article_content` already holds - and put this feature
  in the business of knowing that one of its targets is an article, which §3 exists to avoid.

`GET /public/comments/:id` answers *where* - target, and the parent the comment answers - for
**approved** comments only, so one moderated away since the mail went out is a 404 rather than a
link into a page it is not on. Building the URL from that is the frontend's job.

**The unsubscribe token is the whole credential.** A guest subscriber holds no session, so
`/public/comment-subscriptions/:token` takes no auth - requiring an account to stop unsolicited
email would be requiring an account to withdraw consent. It is 32 random bytes as hex, unique, and
reaches the subscriber only inside the notification email (`comment-notification` template →
`{{ siteUrl }}/comments/unsubscribe/{{ unsubscribe_token }}`). Never log it, never return it from
any other endpoint, and never rotate it on an existing row - the links already in inboxes are the
only way back to it. A token that opens nothing answers 404, not 403.

## 5. Nothing Outlives Its Target

`(entity_type, entity_id)` carries no foreign key anywhere in this area, so every table storing rows
against a polymorphic target clears its own on `entityRemoved` - the **hard**-delete announcement:

| Listener | Clears | On the removal of |
|---|---|---|
| `complaint.listener.ts` | complaints | a comment (its own targets) |
| `rating.listener.ts` | ratings | a comment / an article |
| `comment.listener.ts` | the comments on a target **and** the subscriptions to them | an article / a review |
| `image.listener.ts` | the images filed against a target | an article / brand / category / product |

The comment sweep is wired ahead of any emitter: nothing hard-deletes an article today, and a
feature that starts to - or a new commentable target - only has to emit. There is no self-trigger
either: `comment` announces its own removals as `entity_type: 'comment'`, which is not a member of
`CommentEntityTypeEnum`. Subscriptions go in the same pass, because a subscriber would otherwise
keep a live unsubscribe token for a discussion that no longer exists.

`image.listener.ts` clears **rows only** - the stored file behind `path` stays on disk or in S3,
exactly as the dashboard delete leaves it. Reaping storage is a job nothing does yet.

An article leaves through `deleted_at` and can come back, so a soft delete announces nothing and
everything attached to it stays and becomes answerable again with it.

A complaint is soft-deleted throughout: what was reported and then withdrawn, or dismissed, is
still on record. `updateOwn` / `deleteOwn` are refused once `is_resolved` - the row is the record
the decision is answered from, and the person who asked for it does not get to rewrite it
afterwards.

## 6. A Target May Close

Writing against `(entity_type, entity_id)` is asked for first, through the registry in
`src/shared/registries/target-participation.registry.ts`: `CommentService.create`,
`RatingService.create` and `ComplaintService.create` each call `isParticipationAllowed(entity_type, entity_id, <kind>)` before
anything is stored, and answer **403** with their own `error.not_accepted` message when it is no.

**A target with no resolver registered is open**, which is every one of them but `article` - so
this changed nothing for a comment on a review or a rating on a comment, and a new target costs
these three features nothing.

The dependency runs the same way round as §3 and §5: the feature owning the target registers a
resolver for its own rows from its `*.bootstrap.ts`, and the writing feature asks the registry,
never the feature. `article.bootstrap.ts` resolves the three switches an article carries in
`details` - `allow_rating` / `allow_comments` / `allow_complaints`, defaulting from
`ARTICLE_ALLOW_*`, all on - through `ArticleService.getSettings`.

Two consequences worth knowing:

- **An article that cannot be resolved refuses everything.** Soft-deleted or never there answers
  `false`, because nothing may be attached to a page no reader can open. This is stricter than
  before, where a write against a nonexistent id was stored.
- **The registry is empty in the `test` environment** - bootstrap skips the feature-bootstrap
  pass there, so every target reads as open. A test covering a closed one registers its own
  resolver.

Only `create` is gated. Editing or withdrawing what is already there stays open: closing a
discussion must not trap an author with a comment they can no longer take back.

## 7. Thread Cache

`CommentEntity.HAS_CACHE` is true and the cache is keyed by **target**, not by row
(`cleanThreadCache` → `cacheClean` with `[comment, entity_type, entity_id]`): one approval changes
an unknown number of pages, and they share no id to clean by. The pattern is a prefix, so target 1
also drops 10 and 100 - over-invalidating costs a refill and nothing else.

Anything that changes what a thread shows must go through a service method that calls it. Editing
`status` in SQL leaves the public read serving the old page until the TTL passes; this bites when
fixing data by hand during development.

`CommentSubscriptionEntity.HAS_CACHE` is false, and `ComplaintEntity.HAS_CACHE` is false and must stay so: the public read is per-account (`own`), and
a shared cache would hand one reader another's complaint.

## 8. Frontend Counterpart

`../nready-ui` renders both through entity-agnostic components (`src/components/comment/`,
`src/components/complaint/`) - the report widget offers a *subset* of `ComplaintReasonEnum` per
target (article: misinformation / ai_slop / copyright; comment: spam / offensive / harassment /
hate_speech / misinformation). That subset is presentation only. This validator accepts all seven,
and it should stay that way - the backend is not the place to encode which reasons a page offers.

**Adding a value to `CommentEntityTypeEnum` is not finished when this side compiles.** The digest
links a comment by id (§4) and the frontend turns that id into a URL through a registry -
`src/config/comment-target.config.ts` there, one resolver per target type. A new target with no
entry in it still gets comments, subscriptions and notification emails; only the links *inside*
those emails 404, which nothing here can detect. Say so when you add the enum value, and see
`../nready-ui/.claude/rules/comment.md` §7 for the four-step list on that side.
