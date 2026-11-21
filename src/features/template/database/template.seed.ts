import { v4 as uuid } from 'uuid';
import dataSource from '@/config/data-source.config';
import {
	RequestContextSourceEnum,
	requestContext,
} from '@/config/request.context';
import { Configuration } from '@/config/settings.config';
import TemplateEntity, {
	type TemplateSeedEntry,
	TemplateTypeEnum,
} from '@/features/template/template.entity';
import { getFeaturesFilesPathByFolderAndExtension } from '@/helpers/system.helper';

const templateData: TemplateSeedEntry[] = [
	{
		label: 'email-confirm-create',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Confirm your email',
			html: `
                <p>
                    Please confirm your email by clicking on the following <a href="{{ siteUrl }}/account/email-confirm/{{ token }}">link</a>.
                </p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'email-confirm-update',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Confirm your email',
			html: `
                <p>
                    Please confirm your email by clicking on the following <a href="{{ siteUrl }}/account/email-confirm/{{ token }}">link</a>.
                </p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'email-welcome',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Welcome',
			html: `
                <p>Hello {{ name }}</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'password-recover',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Recover password',
			html: `
                <p>Hello {{ name }}. Click <a href="{{ siteUrl }}/account/password-recover-change/{{ ident }}">here</a> to recover your password. The link will expire at {{ expire_at }}.</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'password-change',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Password changed',
			html: `
                <p>Hello {{ name }}. Your password has been changed.</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'cron-error-count',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Cron error count',
			html: `
                <p>In the last 24 hours there have been {{ errorCount }} cron errors</p>
                <p>Sql Query: {{ querySql }}</p>
                <p>Sql Params: {{ queryParameters }}</p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'cron-warning-count',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Cron warning count',
			html: `
                <p>In the last 7 days there have been {{ warningCount }} cron warnings</p>
                <p>Sql Query: {{ querySql }}</p>
                <p>Sql Params: {{ queryParameters }}</p>
                <p>
                    <table width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; margin-top: 20px;">
                        <tr>
                            <th style="background-color: #2E8B57; color: #ffffff;">Label</th>
                            <th style="background-color: #2E8B57; color: #ffffff;">Occurrences</th>
                            <th style="background-color: #2E8B57; color: #ffffff;">Average Run Time</th>
                        </tr>                        
                        {% for warning in warnings %}
                            <tr>
                                <td>{{ warning.label }}</td>
                                <td>{{ warning.countOccurrences }}</td>
                                <td>{{ warning.avgRunTime }}</td>
                            </tr>
                        {% endfor %}
                    </table>
                </p>
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'cron-time-check',
		language: 'en',
		type: TemplateTypeEnum.EMAIL,
		content: {
			subject: 'Cron time check',
			html: `
                <p>Some cron run time overlapped in the last 24 hours</p>
                <p>Sql Query: {{ querySql }}</p>
                <p>Sql Params: {{ queryParameters }}</p>
                {% for key, row in results %}
                    <p><strong>{{ row.date }}</strong></p>
                    <table width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; margin-top: 20px;">
                        {% for entry in row.entries %}
                            <tr>
                                <td>{{ entry.id }}</td>
                                <td>{{ entry.label }}</td>
                            </tr>
                        {% endfor %}
                    </table>
                {% endfor %}
            `,
			layout: 'layout-default',
		},
	},
	{
		label: 'terms-and-conditions',
		language: 'en',
		type: TemplateTypeEnum.PAGE,
		content: {
			title: 'Terms & Conditions',
			html: `
                <h2>Introduction</h2>
                <p>
                    These Terms & Conditions outline the rules and guidelines for using our website and services.
                    By accessing or using this site, you agree to follow all conditions described here.
                </p>
    
                <h2>Use of the Website</h2>
                <p>
                    You agree to use the website only for lawful purposes and in a way that does not
                    infringe on the rights of others or restrict their use of the platform.
                </p>
    
                <h2>Limitations</h2>
                <p>
                    We are not responsible for any damages resulting from the use of our website or services.
                    Content may change at any time without notice.
                </p>
    
                <h2>Changes to These Terms</h2>
                <p>
                    We may update these Terms & Conditions occasionally. Continued use of the site
                    means you accept the updated terms.
                </p>
		`,
			layout: 'layout-default',
		},
	},
	{
		label: 'privacy-policy',
		language: 'en',
		type: TemplateTypeEnum.PAGE,
		content: {
			title: 'Privacy Policy',
			html: `
                <h2>Overview</h2>
                <p>
                    This Privacy Policy explains how we collect, use, and protect your personal information
                    when you use our website and services.
                </p>
    
                <h2>Information We Collect</h2>
                <p>
                    We may collect basic information such as your name, email address, and usage data
                    to improve our services and enhance your experience.
                </p>
    
                <h2>How We Use Your Information</h2>
                <p>
                    Your information is used to provide services, improve functionality,
                    and communicate important updates. We do not sell your data to third parties.
                </p>
    
                <h2>Data Security</h2>
                <p>
                    We use reasonable security measures to protect your personal information,
                    though no online system can be completely secure.
                </p>
    
                <h2>Updates to This Policy</h2>
                <p>
                    We may update this Privacy Policy from time to time. We encourage you to review it periodically.
                </p>
		`,
			layout: 'layout-default',
		},
	},
];

/**
 * The templates an additional feature owns, collected from every
 * `features/<name>/database/<name>.templates.ts`. Discovery rather than a list of imports so that
 * installing or removing a feature through `cli/feature.ts` needs no edit here - and so that a
 * removed feature cannot leave this file importing a path that no longer exists.
 *
 * Each file default-exports a `TemplateSeedEntry[]`. A feature template collides with a core one
 * only if it reuses a `label`/`language`/`type` triple, which the unique index rejects on insert.
 */
async function loadFeatureTemplates(): Promise<TemplateSeedEntry[]> {
	const paths = getFeaturesFilesPathByFolderAndExtension(
		Configuration.get('folder.features'),
		'/database',
		`templates.${Configuration.resolveExtension()}`,
	);

	const modules = await Promise.all(
		paths.map(async (filePath) => {
			const module = await import(filePath);

			if (!Array.isArray(module.default)) {
				throw new Error(
					`There is no 'export default' template array found in ${filePath}`,
				);
			}

			return module.default as TemplateSeedEntry[];
		}),
	);

	return modules.flat();
}

async function seedTemplates() {
	const connection = dataSource;

	try {
		console.debug('Initializing database connection...');
		await connection.initialize();

		// Loaded before the transaction opens: a feature file that fails to import should not
		// leave the table wiped.
		const featureTemplates = await loadFeatureTemplates();

		await requestContext.run(
			{
				auth_id: null,
				performed_by: 'template.seed',
				source: RequestContextSourceEnum.SEED,
				request_id: uuid(),
				language: 'en',
			},
			async () => {
				await connection.transaction(
					async (transactionalEntityManager) => {
						console.debug('Clearing templates table...');

						const tableName =
							connection.getMetadata(TemplateEntity).tableName;
						const schemaName =
							connection.getMetadata(TemplateEntity).schema ||
							'system';

						// Raw SQL DELETE - won't trigger TypeORM subscribers
						await transactionalEntityManager.query(
							`DELETE FROM "${schemaName}"."${tableName}"`,
						);

						const repository =
							transactionalEntityManager.getRepository(
								TemplateEntity,
							);

						console.debug('Inserting new templates...');

						// Insert new data
						await repository.save([
							...templateData,
							...featureTemplates,
						]);
					},
				);
			},
		);

		console.debug('Templates seeded successfully ✅');
	} catch (error) {
		console.error('Error seeding templates:', error);
		throw error;
	} finally {
		// Only destroy if the connection was initialized
		if (connection?.isInitialized) {
			// Wait a moment to ensure all operations are complete
			await new Promise((resolve) => setTimeout(resolve, 100));
			await connection.destroy();
			console.debug('Database connection closed.');
		}
	}
}

(async () => {
	try {
		await seedTemplates();
	} catch (error) {
		console.error('Seeding failed:', error);
		process.exit(1);
	}
	process.exit(0);
})();
