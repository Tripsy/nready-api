import {
	type TemplateSeedEntry,
	TemplateTypeEnum,
} from '@/features/template/template.entity';

const th = 'style="background-color: #2E8B57; color: #ffffff;"';
const table =
	'width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; margin-top: 10px;"';

/**
 * The staff digest `grn` sends, kept with the feature so `cli/feature.ts` removes it with it. The
 * template seed discovers every `<feature>/database/*.templates.ts`.
 *
 * Staff-facing, so English only - addressed to `app.email`, whose reader's language the system
 * does not know.
 */
const grnTemplates: TemplateSeedEntry[] = [
	{
		label: 'cost-over-floor',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: '{{ total }} price(s) at or under cost',
			html: `
                <p>{{ total }} price(s) have a floor - the min price, or the sale price where no min price is set - at or under what the variant costs, so a sale at that floor earns nothing or loses money. Prices exclude VAT; cost is the weighted average from goods receipts, in {{ base_currency }}. Nothing was changed.</p>
                <table ${table}>
                    <tr><th ${th}>SKU</th><th ${th}>Currency</th><th ${th}>Floor</th><th ${th}>Floor ({{ base_currency }})</th><th ${th}>Cost ({{ base_currency }})</th></tr>
                    {% for row in rows %}
                        <tr><td>{{ row.sku }}</td><td>{{ row.currency }}</td><td>{{ row.floor }} ({{ row.floor_label }})</td><td>{{ row.floor_base }}</td><td>{{ row.cost_price }}</td></tr>
                    {% endfor %}
                </table>
                {% if total > rows.length %}<p>Showing the {{ rows.length }} tightest.</p>{% endif %}
            `,
			layout: 'layout-default',
		},
	},
];

export default grnTemplates;
