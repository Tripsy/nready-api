---
paths:
  - "src/features/shipping/**"
  - "src/features/cart/cart.service.ts"
  - "src/features/cart/cart-fulfillment.ts"
  - "src/features/cart/cart.hooks.ts"
  - "src/features/warehouse-movement/stock-reservation.service.ts"
  - "src/features/warehouse-movement/warehouse-movement.service.ts"
  - "src/features/order-return/**"
---

# Shipping Protocol

**Scope:** What a `shipping` row is, how it moves through its lifecycle, what it may carry, how it
is priced, and how checkout decides which warehouses an order leaves from. Billing a movement's fee
is `settlement.md`'s; drawing its goods from lots is `warehouse-movement`'s (`product.md` §11).

## 1. One table, three movements

`shipping` is every physical movement of goods, told apart by `scope`. Each scope fixes what its
two ends point at and which document it answers to:

| scope | pickup | destination | document |
|---|---|---|---|
| `delivery` | warehouse | client address | `order_id` |
| `relocation` | warehouse | warehouse | `document_ref` (no table yet, no key) |
| `return` | client address | warehouse | `order_id` |

- **`scope` is write-once.** It is not in `paramsUpdateList`; a movement of another kind is a new
  row. `resolveScopeColumns` re-applies the required / forbidden ends on create *and* update.
- **The DB checks only forbid** the ends a scope has no use for. Presence is the service's job,
  because the client-address keys are `ON DELETE SET NULL` - a "must be present" check would turn
  deleting an address into a constraint violation.
- Warehouse ends are `RESTRICT` (they are where stock physically moved); client-address ends are
  `SET NULL` (the frozen snapshots already hold what a shipped row needs).
- `method`: `courier` or `self_pickup`. A self pickup still names its pickup warehouse and has no
  destination, so stock leaves through the same transition either way.

## 2. Lifecycle

`STATUS_TRANSITIONS` on the entity: `pending → preparing → shipped → delivered`, `failed` from any
non-terminal state, `returned` only from `shipped`, `canceled` only before `shipped`. `delivered`,
`failed`, `returned` and `canceled` are terminal. Goods sent back after arriving are a new `return`
row, never a reopened delivery.

All moves go through `ShippingService.updateStatus`:

- **A delivery advances only once its order is `confirmed` / `completed`** (409
  `order_not_confirmed`) - a pending order is still editable, and goods prepared against it could
  disagree with what is finally billed. Withdrawing (`failed`, `canceled`) is always open.
- **Into `shipped` freezes both ends** into `pickup_data` / `destination_data` and stamps
  `shipped_at`. Before that the live references win (a correction before dispatch must reach the
  goods); after it the ends are locked (409 `ends_locked` on `updateData`).
- **Stock moves inside the status transaction, under a row lock**: `shipped` asks
  `moveShippedStock` (FIFO draw from the pickup warehouse, 409 on a shortage), `shipped → returned`
  asks `restoreReturnedStock`, and a `return` into `delivered` asks `receiveReturnedStock`. All
  answered by `warehouse-movement` (`shipping.hooks.ts`); absent, nothing is drawn. `shipped →
  failed` moves nothing - the goods left.
- **A `return` reaches `delivered` only once every line has a `condition`** (409
  `condition_required`, checked under the row lock). Then, after commit, `notifyReturnReceived` -
  answered by `order-return` (§7).
- `shipped_at` / `delivered_at` are stamped once and never re-stamped.
- Every move ends with `notifyShippingChanged` (after commit) - `invoice` bills or stops billing it.

**The order drives its deliveries** (`shipping.bootstrap.ts`): confirmed → `prepareForOrder`
(`pending` → `preparing`), canceled → `cancelForOrder` (unshipped → `canceled`). Returns are left
alone by both. A `canceled` row refuses any edit (`canceled_locked`).

## 3. Lines

`shipping_line` is what travels: **one row per variant** (unique `shipping_id, variant_id`),
`quantity > 0`, `numeric(12,2)` because `kg` / `litre` units exist.

- **Lines name a variant, not an order line** - a relocation has no order. `(variant_id,
  product_id)` is a composite FK, so a variant of another product is refused by the database.
- **Allocation cap** (`assertLinesAllocatable`), per variant, in two pools by direction. A
  `delivery`: the order's other deliveries may not exceed what the order holds (409
  `over_allocated`). A `return`: capped by what `delivered` deliveries carried, less the order's
  other returns not `failed` / `returned` / `canceled` (409 `over_returned`). A variant the order
  does not hold is 422 `invalid_line`. The movement being edited is excluded from the count.
  `getReturnableByVariant` reads the return pool for `order-return`.
- **`condition`** (`resellable` / `damaged`) is a `return` line's only - `writeLines` nulls it on
  every other scope.
- **Only physical, non-header goods travel.** A bundle header holds no stock and is left out, its
  components kept; digital products and services never travel. Checkout (`toShippingLines`) and
  the order sync apply the same rules.
- `writeLines` replaces a movement's lines with a hard delete - a line is a statement about a
  consignment, not a record, and soft-deleted leftovers would skew the allocation sum.
- **Line sync follows one delivery only.** `syncLinesForOrder` (inside a pending order's line
  edit) re-lists the order's goods onto its delivery when it has **exactly one** live delivery
  that has not shipped. With several, or one already shipped, nothing moves - how goods divide
  between parcels is the operator's call.

## 4. Pricing

- `quoteShipping` (`shipping-rate.service.ts`) is the flat-rate table from `settings.shipping`:
  relocation and self pickup are free (relocation still has an operational cost), a courier
  delivery or return pays the domestic or international rate. **An address with no resolvable
  country pays international.** The configured figure is VAT-inclusive in base currency;
  converted, then split to net at the standard rate.
- `priceForBuyer` adds the best `shipping`-scope discount (`discount.md`) - checkout only. A
  back-office movement states its price; `withRateDefaults` fills price / cost from the table only
  when omitted.
- `price` is net, in the client's `currency`; `operational_cost` is base currency and **null until
  known** (zero is a real figure). What the client pays: `(price - discount_reduction) x (1 +
  vat_rate)`. `updateData` pulls `discount_reduction` down if a price edit goes below it.
- **The fee is never in the order total** - each priced movement is its own `shipping` invoice.
  `findBillable` bills `price > 0` only, and `computeOrderPayable` counts the same set, so a
  `price = 0` movement is neither billed nor asked for.

## 5. Checkout - which warehouses an order leaves from

`CartService.toOrder` writes the order's deliveries in the order's own transaction, through
`ShippingService.createWithin` (same scope and allocation rules as a back-office create).

- **Self pickup** - one delivery from the default warehouse (`warehouseService.findDefault`).
- **Courier** - planned by `planDeliveries` (`cart/cart-fulfillment.ts`, pure), fed by
  `resolveWarehouseAvailability` (`cart.hooks.ts`, answered by
  `StockReservationService.getWarehouseAvailability`). Asked **after** `orderService.create`, so it
  reads behind the variant locks the reservation took - racing checkouts plan one after the other.

The planner's rules, highest first:

1. **Fewest deliveries.** Nothing outranks the parcel count.
2. **One warehouse whenever one can fill the order** - the default if it qualifies, else the
   qualifying site holding the most of the order's goods.
3. **Exact smallest set otherwise**: combinations of k = 2, 3, ... candidate sites (sites holding
   at least one needed line, capped at `MAX_CANDIDATE_WAREHOUSES = 10`, ranked default first). Not
   greedy - greedy can cost a parcel.
4. **At equal size**: whole lines beat a divided variant; then a set with the default; then the
   most stock held at the chosen sites for lines the default cannot fill (a variant only secondary
   sites hold goes to the one holding the most); then lower ids.
5. **Inside the set**: a line the default can fill stays there; others go to the chosen site
   holding the most. A variant no site can send whole is divided biggest stock first.
6. **Unsupplied quantity never adds a parcel**: untracked variants and backordered shortfalls ride
   with the delivery already carrying most of that variant, else the first delivery.
7. **The first delivery carries the fee** - the default's group, else the one with most lines. The
   rest are written at `price = 0`, `discount = null`, `operational_cost = null`, so the shopper
   pays the one fee the preview showed and nothing extra is billed.

With `warehouse-movement` absent (or under `test`) the availability is empty and checkout writes
one delivery from the default - the pre-stock behavior.

**Per-site availability** = open lots on confirmed GRNs in active warehouses, less the lines of
live `pending` / `preparing` deliveries picking from that site. A `stock_reservation` names a
variant, not a site, so an order reserving without a delivery (a back-office order) is not
subtracted from any site - the per-variant reservation and the FIFO draw on `shipped` are the
backstops.

**Known gap:** a split order is not re-planned when its lines are edited (§3, line sync) - in
TODO.md.

## 6. Reading

- Dashboard reads join names, never whole rows. `findForOwnOrder` (storefront,
  `GET /orders/:order_id/shipments`) resolves ownership through `OrderService.findOwnById` first
  and uses `join` (not `joinAndSelect`) so warehouse notes and address ids never reach the buyer.
- `findDocumentDetails` feeds the printed shipping invoice - live, soft-deleted rows included.

## 7. Returns (`order-return`)

A return authorization (`order_return` + lines, `RMA` series) is the request and the decision;
the goods move on a `return` movement and the money on invoice reversals. Optional feature,
depending on `order`, `shipping`, `invoice`, `document-series`.

- **Request** - buyer (`POST /public/orders/:order_id/returns`, held to
  `orderReturn.windowDays` after the last delivery) or operator (`POST /order-returns`, not held to
  it). Order `confirmed` / `completed`; lines by variant, `product_id` taken from the order line;
  capped by the shipping return pool less other returns still `requested`. Written under a row
  lock on the order.
- **Approve** (`POST /order-returns/:id/approve`) writes the `return` movement in the same
  transaction (`ShippingService.prepareCreate` + `createWithin`): pickup = the last delivered
  delivery's address, free unless `price` + `vat_rate` are stated, operational cost from the rate
  table. **Destination = the warehouse the goods left from** (`resolveDestination`); a stated one
  must have sent every stock-tracked line - checked here because once the movement ships its ends
  are locked and `receiveReturn` would refuse it.
- **Received** - the movement reaching `delivered` puts the goods back (`receiveReturn`: per lot
  the order's sales drew from at the destination, newest first; resellable = `sale_return` +
  lot restored, damaged = `sale_return` + `write_off`, no `reversal_of_id` - a sale can come back
  in several parcels), then `order-return` moves to `received` and drafts one quantity reversal per
  issued `order` invoice for what the movement carried (`draftRefund`, ids in
  `reversal_invoice_ids`). An operator issues them; issuing refunds. `POST /:id/refund` re-drafts
  only while none is recorded.
- **Cancel** of an approved return withdraws its movement while `pending` / `preparing`; 409 once
  `shipped`. `received` is never set by hand.
