import { lang } from '@/config/message.setup';
import templates from '@/config/nunjucks.config';
import { Configuration } from '@/config/settings.config';
import MailQueueEntity from '@/features/mail-queue/mail-queue.entity';
import { getMailQueueRepository } from '@/features/mail-queue/mail-queue.repository';
import {
	type EmailContent,
	type EmailTemplate,
	TemplateTypeEnum,
} from '@/features/template/template.entity';
import { getTemplateRepository } from '@/features/template/template.repository';
import { getErrorMessage } from '@/helpers/system.helper';
import { getEmailService } from '@/providers/email/email-service.factory';
import { getSystemLogger } from '@/providers/logger.provider';
import type {
	EmailAddressType,
	SendEmailArgs,
} from '@/shared/types/email.type';
import type { EntityId } from '@/shared/types/entity-id.type';

export type EmailQueueData = {
	mailQueueId: EntityId;
	emailContent: EmailContent;
	to: EmailAddressType;
	from?: EmailAddressType;
};

function findTemplate(label: string, language: string) {
	return getTemplateRepository()
		.createQuery()
		.select(['id', 'language', 'type', 'content'])
		.filterBy('label', label)
		.filterBy('language', language)
		.filterBy('type', TemplateTypeEnum.EMAIL)
		.first();
}

export async function loadEmailTemplate(
	label: string,
	language: string,
): Promise<EmailTemplate> {
	/*
	 * Falls back through the configured default to English rather than requiring an exact
	 * language match.
	 *
	 * A missing translation used to mean the user received *no* email at all: the throw
	 * below propagates into `runInBackground`, which logs it and returns, while the
	 * controller has already answered 200. Account recovery and email confirmation both go
	 * through here, so a user in an untranslated language could never verify an address or
	 * reset a password, with nothing in the response to say so.
	 *
	 * Delivering an email in the wrong language is a visible, recoverable annoyance;
	 * delivering nothing is a silent lockout. Only the last resort throws.
	 */
	const candidates = [
		language,
		Configuration.get('language.default'),
		'en',
	].filter(
		(candidate, index, all): candidate is string =>
			Boolean(candidate) && all.indexOf(candidate) === index,
	);

	let template: Awaited<ReturnType<typeof findTemplate>> = null;
	let resolvedLanguage = language;

	for (const candidate of candidates) {
		template = await findTemplate(label, candidate);

		if (template) {
			resolvedLanguage = candidate;
			break;
		}
	}

	if (template && resolvedLanguage !== language) {
		// Warn rather than stay silent: this is a content gap someone should close, and it
		// is otherwise invisible because the email still arrives.
		getSystemLogger().warn(
			{ label, requested: language, used: resolvedLanguage },
			'Email template missing for the requested language - fell back',
		);
	}

	if (!template) {
		throw new Error(
			lang('template.error.cannot_load', {
				label,
				language: candidates.join(', '),
				type: TemplateTypeEnum.EMAIL,
			}),
		);
	}

	return {
		id: template.id,
		language: template.language,
		content: {
			subject: template.content.subject,
			text: template.content.text || undefined,
			html: template.content.html,
			layout: template.content.layout || undefined,
		} as EmailContent,
	};
}

export function prepareEmailContent(template: EmailTemplate): EmailContent {
	try {
		const emailSubject = templates.renderString(
			template.content.subject,
			template.content.vars || {},
		);
		const emailContent = templates.renderString(
			template.content.html,
			template.content.vars || {},
		);

		return {
			subject: emailSubject,
			text: templates.renderString(
				template.content.text || '',
				template.content.vars || {},
			),
			html: template.content.layout
				? templates.render(`emails/${template.content.layout}.html`, {
						language: template.language,
						emailSubject: emailSubject,
						emailContent: emailContent,
					})
				: emailContent,
		};
	} catch (error: unknown) {
		getSystemLogger().fatal(error, getErrorMessage(error));

		throw new Error('Template render error');
	}
}

export async function queueEmail(
	template: EmailTemplate,
	to: EmailAddressType,
	from?: EmailAddressType,
): Promise<void> {
	const mailQueueEntity = new MailQueueEntity();
	mailQueueEntity.template_id = template.id;
	mailQueueEntity.language = template.language;
	mailQueueEntity.content = template.content;
	mailQueueEntity.to = to;
	mailQueueEntity.from = from;

	await getMailQueueRepository().save(mailQueueEntity);
}

export async function sendEmail(data: SendEmailArgs): Promise<void> {
	try {
		if (!data.from) {
			data.from = Configuration.get('mail.from');
		}

		if (!data.replyTo) {
			data.replyTo = data.from;
		}

		await getEmailService()
			.sendEmail(data.content, data.from, data.to, data.replyTo)
			.catch((error) => {
				throw error;
			});
	} catch (error: unknown) {
		getSystemLogger().error(
			error,
			lang('shared.debug.email_error', {
				subject: data.content.subject,
				to: data.to.address,
				error: getErrorMessage(error),
			}),
		);

		throw error;
	}
}
