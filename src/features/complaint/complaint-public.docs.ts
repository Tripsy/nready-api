import {
	ComplaintEntityTypeEnum,
	ComplaintReasonEnum,
} from '@/features/complaint/complaint.entity';
import {
	COMPLAINT_DESCRIPTION_MAX,
	COMPLAINT_DESCRIPTION_MIN,
} from '@/features/complaint/complaint.validator';
import type { complaintPublicController } from '@/features/complaint/complaint-public.controller';
import {
	type ApiInputDocumentation,
	helperApiInputDocumentation,
} from '@/helpers/api-documentation.helper';

/**
 * The reader-facing half of the complaint feature, mounted under `/public/complaints` by
 * `complaint-public.routes.ts`. Documented separately from `complaint.docs.ts` because it is a
 * route module of its own - a different base path, a different controller, and no permission
 * check - even though both describe the same entity.
 *
 * A bearer token is required all the same: no permission is checked, but an account is. A
 * complaint accuses somebody, and an anonymous accusation is one nobody can be asked about.
 */
const ownSample: Record<string, unknown> = {
	id: 8,
	entity_type: ComplaintEntityTypeEnum.COMMENT,
	entity_id: 12,
	reason: ComplaintReasonEnum.SPAM,
	description: 'Same link posted on three articles.',
	is_resolved: false,
	created_at: '2026-08-21T11:02:00.000Z',
};

const targetParams = {
	entity_type: {
		type: 'enum' as const,
		required: true,
		values: Object.values(ComplaintEntityTypeEnum),
		condition:
			'a review is not a target - it is reported by flagging it through moderation instead',
	},
	entity_id: { type: 'string' as const, required: true },
};

const addressingNote =
	"Addressed by target rather than by id: one live complaint per reporter per target, so the path plus the authenticated caller names exactly one row - one they may write by construction. Holding none on that target answers 404, the same answer somebody else's gives";

const descriptionParam = {
	type: 'string' as const,
	required: false,
	condition: `${COMPLAINT_DESCRIPTION_MIN} to ${COMPLAINT_DESCRIPTION_MAX} characters; the reason alone is a complete report`,
};

export const docs: Record<
	keyof typeof complaintPublicController,
	ApiInputDocumentation
> = {
	create: helperApiInputDocumentation({
		description: 'Report a comment or an article',
		withBearerAuth: true,
		success: {
			status: 201,
			description: 'Complaint created successfully',
			dataSample: ownSample,
		},
		withAuthErrors: true,
		withErrors: [403, 409, 422],
		request: {
			notes: 'Strictly an insert: a reporter who already has a live complaint on the target answers 409 and amends it instead, because a second filing would erase text a moderator may already be reading. A target that no longer takes reports answers 403. Filing announces the number of separate reporters, which is what takes a comment out of the thread on its own once enough people have reported it',
			body: {
				...targetParams,
				reason: {
					type: 'enum',
					required: true,
					values: Object.values(ComplaintReasonEnum),
				},
				description: descriptionParam,
			},
			sample: {
				entity_type: ComplaintEntityTypeEnum.COMMENT,
				entity_id: 12,
				reason: ComplaintReasonEnum.SPAM,
				description: 'Same link posted on three articles.',
			},
		},
	}),
	read: helperApiInputDocumentation({
		description: 'Read your own complaint on one target',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint details, or null when none was filed',
			dataSample: ownSample,
		},
		withAuthErrors: true,
		withErrors: [422],
		request: {
			notes: 'Answers null rather than 404 when the caller has filed nothing - it exists so a report widget can show itself as already used instead of walking the reader into a 409',
			params: targetParams,
		},
	}),
	update: helperApiInputDocumentation({
		description: 'Amend your own complaint',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint updated successfully',
			dataSample: ownSample,
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: `Provide at least one of reason or description - the target is what the complaint is and moving it would file a different report under a row a moderator may be reading. Refused once resolved: the row is then the record a disputed decision is answered from. ${addressingNote}`,
			params: targetParams,
			body: {
				reason: {
					type: 'enum',
					required: false,
					values: Object.values(ComplaintReasonEnum),
				},
				description: descriptionParam,
			},
			sample: {
				reason: ComplaintReasonEnum.MISINFORMATION,
			},
		},
	}),
	delete: helperApiInputDocumentation({
		description: 'Withdraw your own complaint',
		withBearerAuth: true,
		success: {
			status: 200,
			description: 'Complaint deleted with success',
		},
		withAuthErrors: true,
		withErrors: [400, 404, 422],
		request: {
			notes: `Soft: the row leaves the moderation queue and frees the slot on that target, so the same reader may file again, while staying readable to anyone reviewing what was reported and later taken back. Refused once resolved, for the same reason an amendment is. ${addressingNote}`,
			params: targetParams,
		},
	}),
};
