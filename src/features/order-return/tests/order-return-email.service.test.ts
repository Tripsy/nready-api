import { expect, jest } from '@jest/globals';
import type { EmailTemplate } from '@/features/template/template.entity';
import type { EmailAddressType } from '@/shared/types/email.type';
import { mockId } from '@/tests/mocks/uuid.mock';

const loadEmailTemplate =
	jest.fn<(label: string, language: string) => Promise<EmailTemplate>>();
const queueEmail =
	jest.fn<(template: EmailTemplate, to: EmailAddressType) => Promise<void>>();

jest.unstable_mockModule('@/providers/email.provider', () => ({
	loadEmailTemplate,
	queueEmail,
}));

const { OrderReturnEmailService, OrderReturnEmailEventEnum } = await import(
	'@/features/order-return/order-return-email.service'
);
const { getOrderReturnEntityMock } = await import(
	'@/features/order-return/order-return.mock'
);

describe('OrderReturnEmailService', () => {
	const service = new OrderReturnEmailService();

	const entry = {
		...getOrderReturnEntityMock({
			response: 'Please pack the item in its original box',
			received_at: new Date('2026-11-14T09:30:00Z'),
		}),
		order: { ref_code: 'ORD', ref_number: 118 },
		shipping: { tracking_number: 'AWB123', tracking_url: null },
		lines: [
			{
				variant_id: mockId(27),
				quantity: '1',
				sku: 'OXF-M',
				label: 'Oxford shirt',
			},
			{
				variant_id: mockId(28),
				quantity: '2',
				sku: 'OXF-L',
				label: null,
			},
		],
	} as never;

	const recipient = {
		name: 'Ana',
		address: 'ana@example.com',
		language: 'ro',
	};

	beforeEach(() => {
		jest.clearAllMocks();

		loadEmailTemplate.mockImplementation(async (label, language) => ({
			id: mockId(1),
			language: language,
			content: { subject: label, html: '' },
		}));
		queueEmail.mockResolvedValue();
	});

	it.each([
		[OrderReturnEmailEventEnum.APPROVED, 'order-return-approved'],
		[OrderReturnEmailEventEnum.REJECTED, 'order-return-rejected'],
		[OrderReturnEmailEventEnum.RECEIVED, 'order-return-received'],
	])('%s renders %s in the recipient language', async (event, label) => {
		await service.send(event, entry, recipient);

		expect(loadEmailTemplate).toHaveBeenCalledWith(label, 'ro');
	});

	it('names the return, the order and the lines, and queues it to the recipient', async () => {
		await service.send(
			OrderReturnEmailEventEnum.APPROVED,
			entry,
			recipient,
		);

		const [template, to] = queueEmail.mock.calls[0];

		expect(to).toEqual({ name: 'Ana', address: 'ana@example.com' });
		expect(template.content.vars).toMatchObject({
			name: 'Ana',
			reference: 'RMA-7',
			order_id: mockId(118),
			order_reference: 'ORD-118',
			response: 'Please pack the item in its original box',
			tracking_number: 'AWB123',
			// Every variable the template reads is defined - Nunjucks runs `throwOnUndefined`
			tracking_url: '',
			lines: [
				{ label: 'Oxford shirt', quantity: 1 },
				{ label: 'OXF-L', quantity: 2 },
			],
		});
	});
});
