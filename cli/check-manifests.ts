import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	type Dependency,
	formatDependency,
	parseDependency,
	parseVersion,
	satisfiesRange,
} from './helpers/version';

/**
 * Fails on a `src/features/*​/manifest.json` that the feature installer would choke on.
 *
 * The manifests are hand-maintained and nothing reads them until someone runs
 * `tsx cli/feature.ts <feature> install`, which is the worst moment to discover that a dependency
 * was renamed two months ago. Nine stale `required_by` entries had accumulated before this check
 * existed.
 *
 * Five checks:
 *
 * 1. **Parseable** - every manifest is valid JSON with the required fields and an `x.y.z` version.
 * 2. **Resolvable** - every `depends_on` names a feature that exists.
 * 3. **Satisfiable** - its version range accepts the version actually present.
 * 4. **Acyclic** - no dependency loop, which would make install order impossible.
 * 5. **Mirrored** - every real dependent appears in the target's `required_by`.
 * 6. **Grounded** - every `@/features/x` a feature imports appears in its `depends_on`.
 *
 * Only (5) is advisory at runtime: `feature.ts` finds reverse dependencies by scanning installed
 * manifests rather than trusting `required_by`, precisely because it drifts. It is still checked
 * here so the declaration means something. The reverse is not checked - a `required_by` entry with
 * no matching `depends_on` may legitimately record intent.
 *
 * (6) skips tests and the feature's `database/` directory - see `isExcludedFromImportScan`. It is
 * otherwise deliberately **one-directional**: an undeclared import is an error, an unimported
 * declaration is not. Plenty of real dependencies leave no import behind -
 * `warehouse_movement.source_type = 'shipping_line'` is a polymorphic reference with no
 * foreign key and no import, seed ordering is expressed in `src/database/seed/index.ts`, and
 * `invoice` declares `cash-flow` ahead of the code that will need it. So the check can only ever
 * ask for a declaration to be added, never removed, and cannot be wrong about intent.
 *
 * Usage: pnpm run manifests:check
 */

const FEATURES_PATH = path.join(process.cwd(), 'src/features');

type Manifest = {
	name: string;
	version: string;
	is_core?: boolean;
	relativePath: string;
	entities: string[];
	depends_on: string[];
	required_by: string[];
};

async function loadManifests(): Promise<Map<string, Manifest>> {
	const manifests = new Map<string, Manifest>();
	const entries = await fs.readdir(FEATURES_PATH, { withFileTypes: true });

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}

		const manifestPath = path.join(
			FEATURES_PATH,
			entry.name,
			'manifest.json',
		);

		let manifest: Manifest;

		try {
			manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
		} catch (error) {
			throw new Error(
				`${entry.name}/manifest.json is unreadable: ${error}`,
			);
		}

		// The directory name is what `depends_on` entries resolve against, so a manifest naming
		// itself differently would be reachable under one name and declared under another
		if (manifest.name !== entry.name) {
			throw new Error(
				`${entry.name}/manifest.json declares name "${manifest.name}"`,
			);
		}

		parseVersion(manifest.version);

		manifests.set(entry.name, manifest);
	}

	return manifests;
}

/**
 * `from '@/features/<name>/...'` and `import('@/features/<name>/...')`.
 *
 * Matches the import specifier rather than any occurrence of the path, so the many doc comments
 * that name a sibling feature do not register as dependencies. `import type` counts: it is erased
 * at runtime, but the feature still cannot compile without the other one present.
 */
const FEATURE_IMPORT = /(?:from|import\()\s*'@\/features\/([a-z0-9-]+)\//g;

/**
 * Pairs that import each other in both directions, so neither can declare the other without
 * creating a cycle the installer could not order.
 *
 * `user` and `account` exchange services - `user.service.ts` calls `accountTokenService`, and
 * `account-oauth.service.ts` calls `userService`. From the installer's point of view they are one
 * feature in two directories, and being core they are never installed or removed separately, so
 * the missing declaration costs nothing. Listed rather than silently skipped: the exemption should
 * be visible enough to argue with.
 */
const CYCLIC_BY_DESIGN = new Set(['user -> account']);

/**
 * Two kinds of file are excluded from the import scan, both because what they import is not what
 * the feature needs in order to *run*:
 *
 * - **Tests.** A test imports whatever it needs to build a fixture, and a fixture is not an
 *   install-time dependency - `user`'s tests reach into `account`, which as a declaration would
 *   make the graph uninstallable.
 * - **The feature's `database/` directory.** A demo seed populates a sibling's table so the
 *   feature has something to point at: `rating.seed.ts` rates articles, `complaint.seed.ts`
 *   reports comments. Declaring those would make `article` a hard install-time dependency of
 *   `comment`, `complaint`, `image` and `rating` - none of which need an article to function, only
 *   to be *demonstrated*. Seed ordering is already expressed in `src/database/seed/index.ts`,
 *   which is where that relationship belongs.
 *
 * The cost is real and worth stating: a seed that imports a feature nobody declares will fail at
 * `pnpm run seed` rather than at install time. That is the trade - an installable graph over a
 * seedable one, since the graph is what other projects are built from.
 */
function isExcludedFromImportScan(filePath: string): boolean {
	return (
		filePath.includes(`${path.sep}tests${path.sep}`) ||
		filePath.endsWith('.test.ts') ||
		filePath.includes(`${path.sep}database${path.sep}`) ||
		filePath.endsWith('.seed.ts')
	);
}

async function listTypeScriptFiles(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });

	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = path.join(directory, entry.name);

			if (entry.isDirectory()) {
				return listTypeScriptFiles(entryPath);
			}

			return entry.isFile() &&
				entry.name.endsWith('.ts') &&
				!isExcludedFromImportScan(entryPath)
				? [entryPath]
				: [];
		}),
	);

	return nested.flat();
}

/** Every other feature this one imports from, mapped to the file that proves it. */
async function findImportedFeatures(
	feature: string,
): Promise<Map<string, string>> {
	const imported = new Map<string, string>();
	const files = await listTypeScriptFiles(path.join(FEATURES_PATH, feature));

	for (const file of files) {
		const content = await fs.readFile(file, 'utf8');

		for (const match of content.matchAll(FEATURE_IMPORT)) {
			const target = match[1];

			if (target !== feature && !imported.has(target)) {
				imported.set(target, path.relative(process.cwd(), file));
			}
		}
	}

	return imported;
}

/** Depth-first walk recording the first cycle it closes. */
function findCycles(manifests: Map<string, Manifest>): string[][] {
	const cycles: string[][] = [];
	const visited = new Map<string, 'open' | 'done'>();
	const stack: string[] = [];

	const visit = (name: string): void => {
		const state = visited.get(name);

		if (state === 'done') {
			return;
		}

		if (state === 'open') {
			cycles.push([...stack.slice(stack.indexOf(name)), name]);

			return;
		}

		visited.set(name, 'open');
		stack.push(name);

		for (const entry of manifests.get(name)?.depends_on ?? []) {
			const dependency = parseDependency(entry).name;

			if (manifests.has(dependency)) {
				visit(dependency);
			}
		}

		stack.pop();
		visited.set(name, 'done');
	};

	for (const name of manifests.keys()) {
		visit(name);
	}

	return cycles;
}

async function main(): Promise<void> {
	const manifests = await loadManifests();
	const problems: string[] = [];

	for (const [name, manifest] of manifests) {
		for (const entry of manifest.depends_on) {
			const dependency: Dependency = parseDependency(entry);
			const target = manifests.get(dependency.name);

			if (!target) {
				problems.push(
					`${name}: depends_on "${formatDependency(dependency)}", which does not exist`,
				);

				continue;
			}

			if (!satisfiesRange(target.version, dependency.range)) {
				problems.push(
					`${name}: depends_on "${formatDependency(dependency)}", but v${target.version} is present`,
				);
			}
		}

		for (const entry of manifest.required_by) {
			const dependency = parseDependency(entry);

			if (!manifests.has(dependency.name)) {
				problems.push(
					`${name}: required_by "${entry}", which does not exist`,
				);
			}
		}
	}

	for (const cycle of findCycles(manifests)) {
		problems.push(`dependency cycle: ${cycle.join(' -> ')}`);
	}

	for (const [name, manifest] of manifests) {
		const declared = new Set(
			manifest.required_by.map((entry) => parseDependency(entry).name),
		);

		for (const [other, otherManifest] of manifests) {
			if (other === name) {
				continue;
			}

			const dependsOnName = otherManifest.depends_on.some(
				(entry) => parseDependency(entry).name === name,
			);

			if (dependsOnName && !declared.has(other)) {
				problems.push(
					`${name}: required_by is missing "${other}", which depends on it`,
				);
			}
		}
	}

	for (const [name, manifest] of manifests) {
		const declared = new Set(
			manifest.depends_on.map((entry) => parseDependency(entry).name),
		);

		for (const [target, file] of await findImportedFeatures(name)) {
			if (
				!declared.has(target) &&
				!CYCLIC_BY_DESIGN.has(`${name} -> ${target}`)
			) {
				problems.push(
					`${name}: imports "${target}" but does not depend_on it (${file})`,
				);
			}
		}
	}

	console.log(`Checked ${manifests.size} feature manifests`);

	if (problems.length === 0) {
		console.log('All manifests resolve.');

		return;
	}

	console.error(`\n${problems.length} problem(s):\n`);

	for (const problem of problems) {
		console.error(`  ${problem}`);
	}

	console.error('');

	process.exitCode = 1;
}

main().catch((error: unknown) => {
	console.error('check-manifests failed:', error);

	process.exitCode = 1;
});
