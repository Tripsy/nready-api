---
paths:
  - "src/features/discount/**"
  - "src/features/cart/cart-pricing.service.ts"
  - "src/features/order/order-discount.service.ts"
---

# Discount Protocol

**Scope:** What a discount attaches to, the order the two resolution passes run in, and how the
money reaches a line. For where the reduction then sits in the line arithmetic, see `product.md`
§10.4.

## 1. Six scopes, two shapes

`client`, `product`, `variant`, `category` and `brand` attach to rows through `discount_target`,
which is polymorphic and holds all five. **`order` takes no targets** - `ScopeWithTargets` excludes
it at the type level - and applies to the basket as a whole.

That split is why there are two queries rather than one. `findCandidates` inner-joins
`discount_target`, so an order-wide campaign can never appear in it; `findOrderCandidates` selects
on the scope column alone. Folding the two together would charge a campaign once per line.

Country is **not** a scope. It describes the buyer rather than the goods, so it is a condition
(`conditions.applicable_countries`) evaluated after candidates are selected.

**Country codes are ISO 3166-1 alpha-2, everywhere.** The codebase has one country vocabulary and
this is it, because the one input nobody controls sets it: `article_visibility_rule.allowed_countries`
is compared against CDN geo headers (`getRequestCountry` reads `cf-ipcountry` and friends, which
emit alpha-2 and discard anything that is not two characters). A discount's list is matched against
`place.alpha2_code`, filled in per country for exactly this purpose. `place.code` stays alpha-3 -
it is the place seed's natural key, not a rule's vocabulary, and the two must not be confused.

## 2. The two passes, in order

1. **Line scope.** The single best rule per line wins outright - largest reduction, ties to the
   lowest id. No scope precedence: a product promotion can beat a client agreement. Clamped to
   `product_price.min_price`.
2. **Order scope.** One campaign for the whole basket, costed against what the lines still cost
   after pass 1, then apportioned back onto them.

**They stack.** Pass 2 applies on top of pass 1 rather than competing with it, which is how a
shopper reads "an extra 10% off". The floor is re-checked against both together: the basis handed
to pass 2 carries each line's `headroom`, what is left before `min_price` with pass 1 already
deducted. A floor that only bound pass 1 would let the stack walk straight through it.

## 3. `min_order_value` reads the gross subtotal

Both passes test the threshold against the subtotal **before any discount**, in base currency.

This is not a detail to "improve" later. A threshold tested against a figure the discounts have
already moved is circular - applying a discount drops the basket back under the bar that qualified
it - and with two passes stacking there is no evaluation order that settles it. The gross figure is
stable, so both passes see the same one.

## 4. Apportionment

An order-wide campaign is costed once against the basket, then split pro-rata by what each line
still costs, through `apportion()` (`helpers/shop.helper`), which assigns the rounding remainder to
the largest share so the parts reconcile to the whole exactly.

Splitting is what makes the VAT right: each line gives up its share **at its own rate**, and one
figure held over a mixed-rate document cannot do that. It is the same reason a bundle explodes
(`product.md` §8.3).

⚠️ **A clamped line loses its share rather than passing it on.** Where a floor bites, the campaign
takes less than its headline figure. Redistributing the remainder needs a second pass that can
breach another line's floor in turn, and what the document records has to be a figure it can
explain.

Bundle headers and lines carrying an `issue` are excluded from the basis - a header holds no money
to reduce, so a campaign naming a bundle product reaches its components and not the header.

## 5. Where the money lives

`order_line.discount` is a `DiscountSnapshot[]` and `cart` lines mirror it. A line carries its own
best discount and, stacked on top, its apportioned share of a campaign - **each snapshot states its
own `reduction`**, and `discount_reduction` is their sum.

- **`discount_reduction` is the only figure VAT is charged on.** The campaign's share has to be
  inside it, or the tax base is wrong.
- **A snapshot's `reduction` cannot be replayed** from `type` and `value`: neither carries the floor
  the figure was clamped to. Same reason the line total is stored rather than derived.
- **`discount_id`** is on the snapshot so reporting groups by the rule rather than matching on
  `label` or `reference`, either of which an operator may edit afterwards.
- **`OrderTotals.order_discount_reduction` is derived**, by summing the snapshots whose scope is
  `order`. It is a breakdown of `discount_reduction`, never a further subtraction.

## 6. Deliberately absent

- **No discount columns on `order`.** They would duplicate money that already lives in the lines and
  could drift from it. `invoice.discount` is a header-level jsonb because an invoice has no line
  table at all; an order does.
- **No synthetic discount lines.** `order_line.variant_id` and `product_id` are `NOT NULL` under a
  composite foreign key to `product_variant (id, product_id)`, every downstream consumer assumes a
  line is a sellable thing (shipment allocation, revenue by product, stock), and one negative line
  cannot carry mixed VAT rates.
- **No coupon entry.** `discount.reference` holds codes, but nothing accepts one from a shopper.

## 7. Where it is resolved

- **Cart** - `cart-pricing.service.ts`, three passes: price, line discounts, campaign. Priced
  against a client only when the caller names one (`CartPricingContext.clientId`), which the
  checkout screen does and the basket page does not, since an account may hold several clients.
- **Checkout** - `CartService.toOrder`, which prices once more against the chosen client and freezes
  the result.
- **Back office** - `OrderDiscountService.resolveForLines`, one call returning both passes, used by
  `createEntry` and `buildLines`. The operator states the price; what comes off it is the catalog's
  decision.
