/**
 * What an order carries besides its goods that is billed on a document of its own - a movement of
 * goods, a subscription - reached without `invoice` importing the feature that owns it.
 *
 * `invoice` keeps everything generic: whether a source is already billed (read from
 * `invoice_source`), numbering, parties, settlement. What a source *is* - which rows of an order are
 * billable at all, what lines bill one, how far an operator may edit those lines - belongs to the
 * feature that owns the row, which registers a provider from its own `*.bootstrap.ts`. The source
 * type is a value of `invoice_source.source_type`, so a new provider also adds that enum value.
 *
 * **Optional per type.** With the owning feature absent nothing is registered: its sources are
 * never raised automatically, and a document of that type is refused rather than raised blind.
 *
 * Awaited by the caller, read-only, outside any transaction - a provider reads its own rows and
 * writes nothing.
 *
 * The shapes below are declared here rather than imported - the import is the dependency this file
 * exists to remove.
 */

/** One line a source is billed with, before `invoice` computes its net, VAT and total. */
export type BillableLine = {
	label: string;
	quantity: number;
	unit_price: number;
	vat_rate: number;
	discount_reduction: number; // Money already taken off the line, kept out of its net
};

/** A row an order carries that bills on a document of its own. */
export type BillableSource = {
	id: number;
	order_id: number;
	lines: readonly BillableLine[];
};

/** How far a line billing a source may be edited on a draft. */
export type BillableLineCap = {
	max_quantity: number;
	max_unit_price: number;
};

export type BillableSourceProvider = {
	/**
	 * True when a row is billed by one live document at most - a movement's fee. False when it is
	 * billed repeatedly - a subscription, once per period.
	 */
	billedOnce: boolean;

	/**
	 * The rows of an order billed automatically when the order is - each raised on its own document
	 * unless one already bills it. Empty for a type raised only by hand.
	 */
	listBillable(orderId: number): Promise<BillableSource[]>;

	/** One row, or null when it does not exist or cannot be billed at all. */
	findBillable(sourceId: number): Promise<BillableSource | null>;

	/**
	 * The edit ceiling of the lines billing these rows, by row id. Read for documents already
	 * raised, so a row since deleted or no longer billable still answers; one absent from the map is
	 * not capped.
	 */
	getLineCaps(
		sourceIds: readonly number[],
	): Promise<Map<number, BillableLineCap>>;
};

const providers = new Map<string, BillableSourceProvider>();

/** One provider per source type; `null` unregisters it, which is what a test resets to. */
export function registerBillableSourceProvider(
	sourceType: string,
	provider: BillableSourceProvider | null,
): void {
	if (provider) {
		providers.set(sourceType, provider);
	} else {
		providers.delete(sourceType);
	}
}

/** The provider of a source type, or null when the feature owning it is not installed. */
export function getBillableSourceProvider(
	sourceType: string,
): BillableSourceProvider | null {
	return providers.get(sourceType) ?? null;
}
