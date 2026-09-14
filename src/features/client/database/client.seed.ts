import {
	isDirectRun,
	loadIds,
	randomInt,
	randomPick,
	type SeedDefinition,
	type SeedSummary,
	sequenceLabel,
	topUp,
} from '@/database/seed/seed.helper';
import { runSeedFile } from '@/database/seed/seed.runner';
import ClientEntity, {
	ClientStatusEnum,
	ClientTypeEnum,
} from '@/features/client/client.entity';
import UserEntity from '@/features/user/user.entity';

const TARGET = 25;

const COMPANY_PREFIXES = [
	'Trans',
	'Euro',
	'Cargo',
	'Rapid',
	'Nord',
	'Pro',
	'Delta',
	'Prime',
] as const;

const COMPANY_SUFFIXES = [
	'Logistic',
	'Express',
	'Freight',
	'Shipping',
	'Distribution',
] as const;

const FIRST_NAMES = [
	'Andrei',
	'Maria',
	'Ionut',
	'Elena',
	'Radu',
	'Cristina',
	'Mihai',
	'Ana',
] as const;

const LAST_NAMES = [
	'Popescu',
	'Ionescu',
	'Dumitrescu',
	'Stanciu',
	'Marin',
	'Gheorghe',
] as const;

const BANK_NAMES = [
	'Banca Transilvania',
	'BCR',
	'ING Bank',
	'Raiffeisen Bank',
	'BRD',
] as const;

export const clientSeed: SeedDefinition = {
	name: 'client',
	run: async ({ manager, random }): Promise<SeedSummary> => {
		const userIds = await loadIds(manager, UserEntity);

		return topUp({
			entity: 'client',
			target: TARGET,
			manager,
			entityClass: ClientEntity,
			/*
			 * `contact_email` rather than one of the unique business columns: those are
			 * split across the two client types (`company_cui` for companies,
			 * `person_identification_number` for persons), and the latter is `select: false`
			 * so it cannot be read back for comparison. The contact address is present on
			 * both and is generated from the index, so it identifies a seeded row uniquely.
			 */
			keyColumn: 'contact_email',
			buildRow: (index) => {
				const label = sequenceLabel(index);
				const contactEmail = `client-${label}@demo.test`;

				// Every fourth client is a natural person, to exercise both branches of the
				// client-type discriminator in the dashboard.
				const isPerson = index % 4 === 3;

				const status = randomPick(random, [
					ClientStatusEnum.ACTIVE,
					ClientStatusEnum.ACTIVE,
					ClientStatusEnum.ACTIVE,
					ClientStatusEnum.INACTIVE,
					ClientStatusEnum.PENDING,
				]);

				const iban = `RO${randomInt(random, 10, 99)}BTRL${label}${randomInt(random, 100000, 999999)}`;

				/*
				 * Two in three clients belong to an account, cycling through the users so some
				 * accounts hold more than one - a person billing privately and through a company.
				 * The rest stay unlinked, the shape of a client typed in from the back office.
				 * Only rows inserted by this run get the link; `topUp` never rewrites a stored one.
				 */
				const userId =
					userIds.length > 0 && index % 3 !== 2
						? userIds[index % userIds.length]
						: null;

				if (isPerson) {
					const personName = `${randomPick(random, FIRST_NAMES)} ${randomPick(random, LAST_NAMES)}`;

					return {
						client_type: ClientTypeEnum.PERSON,
						status,
						company_name: null,
						company_cui: null,
						company_reg_com: null,
						person_name: personName,
						// Not a real CNP format on purpose - it is demo data, and the column
						// is `select: false` precisely because it is sensitive.
						person_identification_number: `19000${label}00${index}`,
						iban,
						bank_name: randomPick(random, BANK_NAMES),
						contact_name: personName,
						contact_email: contactEmail,
						contact_phone: `+407${randomInt(random, 10000000, 99999999)}`,
						user_id: userId,
						notes: null,
					};
				}

				const companyName = `${randomPick(random, COMPANY_PREFIXES)}${randomPick(random, COMPANY_SUFFIXES)} ${label}`;

				return {
					client_type: ClientTypeEnum.COMPANY,
					status,
					company_name: companyName,
					// The `RO9` prefix keeps generated identifiers clear of the hand-entered
					// rows already in the database, which the partial unique index guards.
					company_cui: `RO9${label}${randomInt(random, 100, 999)}`,
					company_reg_com: `J40/${1000 + index}/2026`,
					person_name: null,
					person_identification_number: null,
					iban,
					bank_name: randomPick(random, BANK_NAMES),
					contact_name: `${randomPick(random, FIRST_NAMES)} ${randomPick(random, LAST_NAMES)}`,
					contact_email: contactEmail,
					contact_phone: `+407${randomInt(random, 10000000, 99999999)}`,
					user_id: userId,
					notes: null,
				};
			},
		});
	},
};

if (isDirectRun(import.meta.url)) {
	await runSeedFile(clientSeed);
}
