import {
	type TemplateSeedEntry,
	TemplateTypeEnum,
} from '@/features/template/template.entity';

const linesTable = `
                <ul>
                    {% for line in lines %}
                        <li>{{ line.quantity }} x {{ line.label }}</li>
                    {% endfor %}
                </ul>`;

const orderLink =
	'<a href="{{ siteUrl }}/account/orders/{{ order_id }}">Follow the return on your order page</a>';

/**
 * The buyer emails `order-return` sends, kept with the feature so `cli/feature.ts` removes them
 * with it. The template seed discovers every `<feature>/database/*.templates.ts`.
 *
 * Rendered by `order-return-email.service.ts`. English only: a language with no template of its
 * own falls back inside `loadEmailTemplate`. `received` lists no lines - the warehouse may have
 * corrected the request on arrival, and the refund drafted from what actually came back is what
 * the buyer is told about next.
 */
const orderReturnTemplates: TemplateSeedEntry[] = [
	{
		label: 'order-return-approved',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Your return {{ reference }} was approved',
			html: `
                <p>Hello {{ name }}, your return {{ reference }} for order {{ order_reference }} was approved.</p>
                ${linesTable}
                {% if response %}<p>{{ response }}</p>{% endif %}
                {% if tracking_number %}
                    <p>
                        Return shipment: {{ tracking_number }}
                        {% if tracking_url %}- <a href="{{ tracking_url }}">track it</a>{% endif %}
                    </p>
                {% endif %}
                <p>Once the goods reach us we will let you know and prepare your refund.</p>
                <p>${orderLink}</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'order-return-rejected',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Your return {{ reference }} could not be accepted',
			html: `
                <p>Hello {{ name }}, we reviewed your return {{ reference }} for order {{ order_reference }} and could not accept it.</p>
                ${linesTable}
                {% if response %}<p>{{ response }}</p>{% endif %}
                <p>${orderLink}</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'order-return-received',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'We received your return {{ reference }}',
			html: `
                <p>Hello {{ name }}, the goods you sent back under return {{ reference }} for order {{ order_reference }} reached us{% if received_at %} on {{ received_at }}{% endif %}.</p>
                <p>Your refund is being prepared.</p>
                <p>${orderLink}</p>
            `,
			layout: 'layout-default',
		},
	},
];

export default orderReturnTemplates;
