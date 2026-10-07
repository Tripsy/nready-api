---
paths:
  - "src/features/order/**"
  - "src/features/invoice/**"
  - "src/features/order-settlement/**"
  - "src/features/cash-flow/**"
  - "src/features/shipping/**"
  - "src/features/cart/cart.service.ts"
  - "src/features/client-ledger/**"
---

# Order Settlement Protocol

**Order, invoice, payment and ledger run one way, through hooks each writer declares for its own
rows** - `order.hooks.ts`, `cash-flow.hooks.ts`, `shipping.hooks.ts`, `invoice.hooks.ts` (built on
`helpers/hook.helper.ts`; the chain's design notes are in `invoice.hooks.ts`). Two features
register:

- **`invoice` - billing.** `invoice.bootstrap.ts` owns order placed / confirmed, cash flow
  completed and shipping changed: it raises documents and spreads money over them
  (`InvoiceSettlementService`), then announces every order it touched with
  `notifyOrderStateChanged`. It never moves an order's status.
- **`order-settlement` - order status, optional** (`src/features/order-settlement/`, depends on
  `order`, `invoice`, `product`, `shipping`). Its bootstrap registers the order-state-changed
  handler → `OrderSettlementService.evaluateMany`. Absent → billing and allocation run the same,
  orders change status by hand only. Anything in `invoice` that may move an order's standing
  (issue, allocate, a delivery change) calls `notifyOrderStateChanged`, never the service.

## Documents

- Invoice scopes (`invoice.scope`, `InvoiceScopeEnum`): `order` (goods, `product` lines), `shipping` (one movement's fee, `shipping`
  line - the fee lives on `shipping.price`, never in the order total), `subscription` (adjustment
  lines, by hand for now), `custom` (built by hand for a client, no order: `adjustment` lines
  written through `PUT /invoices/:id` - `POST /invoices/custom` raises it empty, and a bare
  revenue movement through `raiseForCashFlow` raises one with a single line). Every invoice,
  reversals included, numbers from the `invoice` series (`INVOICE_DOCUMENT_TYPE`).
- **Reversal (storno) is a flag, not a scope**: `is_reversal = true` + `parent_invoice_id`, same
  scope as the original (DB check: `is_reversal = (parent_invoice_id IS NOT NULL)`). Raised with
  `POST /invoices/:id/reverse`, full or partial, each reversal line pointing at its original
  through `invoice_line.parent_line_id`. A line is taken back by `quantity` (goods returned, units
  billable again) or by net `amount` (`is_value_reversal`: a price correction, one unit at the
  line's VAT rate, no `order_line_id`/`shipping_id`, so nothing becomes billable). Caps per original
  line, over every non-canceled reversal: quantity by quantity reversals, net by all of them. A reversal cannot be reversed, gets no hand-added lines, and
  its line figures are locked. Figures stay positive; the flag carries the sign.
- An order carries many documents. `getBilledQuantities` (order lines) / `getBilledSourceIds`
  (rows of a source type, read from `invoice_source`) say what is already billed - originals count
  from `draft`, reversals only once `issued`, and a value-only reversal releases no source.
  `raiseForOrder` bills the remainder and returns null when nothing is left; that null is the
  duplicate guard every automatic caller relies on.
- Pending orders are invoiced (`INVOICEABLE_ORDER_STATUSES`); a live `order` document locks the
  order's lines (`isOrderInvoiced`).
- **`invoice.client_id` is the one link column** - every invoice has a client. What it was raised
  from lives in `invoice_source` (`invoice-source.entity.ts`): `(invoice_id, source_type, source_id)`
  for `order` / `shipping` / `subscription`, no key to the target (like `operational_record`), one
  per type, written once at raise and copied onto reversals. A new billable feature adds a
  `source_type`, not a column. Read a loaded invoice's sources only through
  `InvoiceService.withSources` / `findById`, which return `InvoiceWithSources` - a row loaded any
  other way does not carry them, and anything needing `order_id` asks for that type. Query "documents
  of source X" with `sourceFilter` (a subquery) or `findIdsBySource`. TODO on the entity: nothing
  stops a hard delete of an invoiced order since the `RESTRICT` went with the column.
- An `order` document carries `product` lines only - every movement is billed on its own
  `shipping` document, whose `shipping` source and one `shipping` line name the same movement.
- **Billable sources other than the order go through the keyed provider in `invoice.hooks.ts`.**
  A feature depending on `invoice` registers its provider from its own bootstrap
  (`subscription.bootstrap.ts`); one `invoice` depends on cannot import back, so `invoice`
  registers it itself from `sources/` (`sources/shipping.source.ts`, labels under
  `invoice.label.shipping_*`). A provider has: `billedOnce`, `listBillable(orderId)` (auto-raised rows),
  `findBillable(id)` (null = not billable), `getLineCaps(ids)`. `invoice` keeps the generic side:
  `getBilledSourceIds`, `getUnbilledSources`, `buildLinesForSource`, `raiseForSource(type, id)`.
  No provider → the type is never auto-raised and a manual create is refused
  (`source_not_installed`). A new billable feature = a `source_type` enum value + an
  `InvoiceScopeEnum` value + an entry in `SOURCE_INVOICE_SCOPES` + its provider. `invoice` still
  depends on `shipping` for the `invoice_line.shipping_id` key and its `ShippingEntity` relation;
  the delivery evaluation lives in `order-settlement` (`OrderSettlementService.isDelivered`).

## Chain

- **Checkout** writes order + first delivery + a `pending` `cash_flow` (filed under the client and
  the order via `operational_record`), then `notifyOrderPlaced` → order and shipping documents
  raised and issued.
- **Capture** (`cash_flow` → `completed`) → `notifyCashFlowCompleted` → ledger entry, then
  `invoiceSettlementService.settleClient` → `invoicePaymentService.settleClient`: **strict FIFO by client**, per currency, oldest money to
  the document falling due first, under a client advisory lock. The order a payment names plays
  no part.
- **Settled orders** (`order-settlement`, on `notifyOrderStateChanged`) - `OrderSettlementService.evaluate`: `pending` → `confirmed` when fully
  invoiced and every live billing document paid; → `completed` when also every delivery arrived
  and covers the physical lines. Never backwards, never a canceled order.
- **Operator confirm** → `notifyOrderConfirmed` → bill the remainder (whole order on the
  back-office path). **Shipping created / status changed** → `notifyShippingChanged` → bill a new
  priced movement on an already billed order, then announce the order for re-evaluation.
- **By hand** - `POST /invoices/:id/payments` allocates one movement to one document;
  `DELETE /invoices/:id/payments` clears every allocation, `DELETE .../payments/:payment_id`
  one. **Money never moves between clients**: the movement's client (`cashFlowService.findClientId`)
  must be the invoice's. An allocation is capped by what is left of the movement and by what the
  document still asks for; every write to a client's allocations (FIFO included) takes the same
  client advisory lock. Clearing is refused on a reversal (its allocations are refunds paid out)
  and on an original with an issued reversal (open money is amount less allocations, no refund
  subtracted, so freeing them would double-spend refunded money). Clearing re-spreads nothing and
  never moves the order back; the next capture or issue spreads what is still unallocated, FIFO.
- Every step runs **after** the previous write commits and logs rather than throws. Cash on
  delivery stays `pending` until the operator confirms it.

## Client ledger (`client_ledger`)

- **The money that moved with a client, nothing else**: one entry per **completed** cash flow
  filed under a client (`operational_record` `client`; a refund under its parent's client).
  `payment` + (money in), `refund` - (money out); the sum is the net money received. Documents
  write nothing - what a client was charged or owes is read from their invoices. `amount <> 0`;
  one entry per movement (unique `cash_flow_id`).
- **Its own, optional feature** (`src/features/client-ledger/`, depends on `client`, `cash-flow`).
  `cash-flow` books through `cash-flow.hooks.ts`
  (`recordLedgerMovement`) from `cashFlowService.completeWithin`, **inside the transaction that
  completes the movement** - `updateStatus` and a reversal's refund both complete through it.
  `client-ledger.bootstrap.ts` registers the recorder; feature absent → no-op. Never write
  `status = completed` on a cash flow by hand: go through `completeWithin`, or the entry is
  missed until `client-ledger-reconcile.cron.ts` (and the demo seed) back-fill it.
- Allocation writes nothing to it - matching moves no money.
- **An issued invoice is never canceled** - `STATUS_TRANSITIONS` gives `issued` no move. It is taken
  back only by a reversal, which numbers a document and refunds what was paid. Only a draft
  cancels, and a draft has no number or allocation to undo.
- An issued reversal counts toward its parent's `payment_status` (`getReversedAmount`); a reversal's
  own `payment_status` counts only refunds (outgoing movements).
- **Issuing a reversal refunds** (`InvoiceService.refundReversal`, inside the issue transaction):
  owed back = paid on the original - (original total - issued reversals) - refunds earlier
  reversals made, capped at the reversal's total. Each refund is a **completed** `refund` cash flow
  naming the incoming movement it returns (`parent_id`, newest allocation first), completed
  through `completeWithin` (so booked on the ledger as `refund -`) and allocated to the reversal.
  An unpaid original moves no money. Always refunded, never offset against the client's other
  documents. FIFO and order settlement read
  originals only (`is_reversal = false`).
