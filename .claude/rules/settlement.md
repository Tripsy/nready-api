---
paths:
  - "src/features/order/**"
  - "src/features/invoice/**"
  - "src/features/cash-flow/**"
  - "src/shared/registries/order-settlement.registry.ts"
---

# Order Settlement Protocol

**Order, payment and invoice run one way, through
`src/shared/registries/order-settlement.registry.ts`.**

- A checkout raises the order `pending` *and* a `pending` `cash_flow` for what the buyer owes gross
  (`vat_rate` 0 - the VAT breakdown is the invoice's to state), linked to the order by an
  `operational_record` of type `order` rather than by a column, so the ledger keeps no document
  FKs.
- Capturing that movement confirms the order; confirming the order raises and issues the charge
  and allocates the movement to it.
- Each step is registered by the feature that owns the rows it writes, runs **after** the previous
  write commits, and logs rather than throws on failure - so what is left behind is always
  something an operator can finish by hand.
- Cash on delivery takes the same shape; its movement simply stays `pending` until the courier
  settles.
