import {
	type TemplateSeedEntry,
	TemplateTypeEnum,
} from '@/features/template/template.entity';

const th = 'style="background-color: #2E8B57; color: #ffffff;"';
const table =
	'width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; margin-top: 10px;"';

/**
 * The staff digests `warehouse-movement` sends, kept with the feature so `cli/feature.ts` removes
 * them with it. The template seed discovers every `<feature>/database/*.templates.ts`.
 *
 * Staff-facing, so English only - addressed to `app.email`, whose reader's language the system
 * does not know.
 */
const warehouseMovementTemplates: TemplateSeedEntry[] = [
	{
		label: 'stock-reconcile',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject:
				'Stock reconcile: {{ lotCount + reservationCount + overCommittedCount }} finding(s)',
			html: `
                <p>The nightly stock reconcile found figures that need a look. Nothing was corrected - each one below is reported as found.</p>
                {% if lots.length %}
                    <p><strong>Lots whose ledger does not add up ({{ lotCount }})</strong> - the movements on the lot no longer explain its balance.</p>
                    <table ${table}>
                        <tr><th ${th}>Lot</th><th ${th}>Variant</th><th ${th}>Warehouse</th><th ${th}>Lot says</th><th ${th}>Ledger says</th></tr>
                        {% for lot in lots %}
                            <tr><td>#{{ lot.grn_item_id }}</td><td>#{{ lot.variant_id }}</td><td>#{{ lot.warehouse_id }}</td><td>{{ lot.qty_remaining }}</td><td>{{ lot.ledger }}</td></tr>
                        {% endfor %}
                    </table>
                {% endif %}
                {% if reservations.length %}
                    <p><strong>Reservations that disagree with their order ({{ reservationCount }})</strong></p>
                    <table ${table}>
                        <tr><th ${th}>Order</th><th ${th}>Status</th><th ${th}>Variant</th><th ${th}>Reserved</th><th ${th}>Expected</th></tr>
                        {% for row in reservations %}
                            <tr><td>#{{ row.order_id }}</td><td>{{ row.order_status }}</td><td>#{{ row.variant_id }}</td><td>{{ row.reserved }}</td><td>{{ row.expected }}</td></tr>
                        {% endfor %}
                    </table>
                {% endif %}
                {% if overCommitted.length %}
                    <p><strong>Variants promised beyond what is on hand ({{ overCommittedCount }})</strong> - orders that cannot ship as things stand.</p>
                    <table ${table}>
                        <tr><th ${th}>SKU</th><th ${th}>On hand</th><th ${th}>Reserved</th><th ${th}>Available</th></tr>
                        {% for row in overCommitted %}
                            <tr><td>{{ row.sku }}</td><td>{{ row.on_hand }}</td><td>{{ row.reserved }}</td><td>{{ row.available }}</td></tr>
                        {% endfor %}
                    </table>
                {% endif %}
                <p>Each list shows at most {{ limit }} rows.</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'stock-low',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: '{{ total }} variant(s) low on stock',
			html: `
                <p>{{ total }} stock-tracked variant(s) are at or under their low-stock threshold, measured on what is available to sell - on hand less what orders already reserve.</p>
                <table ${table}>
                    <tr><th ${th}>SKU</th><th ${th}>On hand</th><th ${th}>Reserved</th><th ${th}>Available</th><th ${th}>Threshold</th></tr>
                    {% for row in variants %}
                        <tr><td>{{ row.sku }}</td><td>{{ row.on_hand }}</td><td>{{ row.reserved }}</td><td>{{ row.available }}</td><td>{{ row.low_stock_threshold }}</td></tr>
                    {% endfor %}
                </table>
                {% if total > variants.length %}<p>Showing the {{ variants.length }} lowest.</p>{% endif %}
            `,
			layout: 'layout-default',
		},
	},
];

export default warehouseMovementTemplates;
