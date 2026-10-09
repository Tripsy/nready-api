import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Request } from 'express';

export const ROOT_PATH = process.cwd();
export const SRC_PATH = path.join(ROOT_PATH, 'src');

/**
 * The extension of the source files this process runs: `ts` under tsx and ts-jest, `js` in the
 * compiled build. Every discovery glob (entities, migrations, routes, crons, ...) matches on it.
 *
 * Read off this module's own URL rather than off `APP_ENV`: the two are independent, and a build
 * started with `APP_ENV=development` would otherwise look for `.ts` files in `dist/`, find none,
 * and boot with no entities, routes or jobs - and no error.
 */
export const SOURCE_EXTENSION: 'ts' | 'js' = import.meta.url.endsWith('.ts')
	? 'ts'
	: 'js';

export function buildRootPath(...args: string[]) {
	return path.join(ROOT_PATH, ...args);
}

export function buildSrcPath(...args: string[]) {
	return path.join(SRC_PATH, ...args);
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a thrown error is a module that could not be resolved.
 *
 * For a `catch` around a dynamic `import()` of an optional file, where the module simply not
 * being there is the ordinary case and anything else is a fault worth reporting. Node reports
 * it under either code depending on the loader, so both are accepted.
 */
export function isModuleNotFound(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;

	return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/**
 * Check if a string is a valid IP address
 *
 * @param {string} ip - The IP address to check
 * @returns {boolean} - True if the IP address is valid, false otherwise
 */
export function isValidIp(ip: string): boolean {
	return net.isIP(ip) !== 0; // Returns 4 for IPv4, 6 for IPv6, and 0 for invalid
}

export function getClientIp(req: Request): string {
	const reqXForwardedFor = (req.headers['x-forwarded-for'] as string)
		?.split(',')[0]
		.trim()
		.replace(/^::ffff:/, '');

	if (isValidIp(reqXForwardedFor)) {
		return reqXForwardedFor;
	}

	const reqIp = req.ip?.replace(/^::ffff:/, '') || '';

	if (isValidIp(reqIp)) {
		return reqIp;
	}

	return 'n/a';
}

export function listDirectories(originPath: string): string[] {
	const stat = fs.statSync(originPath);

	if (!stat.isDirectory()) {
		throw new Error(
			`Cannot list folders. Origin path is not a directory: ${originPath}`,
		);
	}

	return fs
		.readdirSync(originPath, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.filter((dirent) => !dirent.name.startsWith('.')) // Skip hidden directories
		.map((dirent) => dirent.name);
}

export function listFiles(originPath: string): string[] {
	/*
	 * A convention-scanned folder is allowed not to exist: these are optional slots - a project
	 * started from this boilerplate may have no shared listeners, no shared cron jobs - and
	 * "nothing to discover" is the honest answer, not a fatal error. `statSync` throws on a
	 * missing path, which took the whole bootstrap down the first time such a folder emptied.
	 */
	if (!fs.existsSync(originPath)) {
		return [];
	}

	const stat = fs.statSync(originPath);

	if (!stat.isDirectory()) {
		throw new Error(
			`Cannot list files. Origin path is not a directory: ${originPath}`,
		);
	}

	return fs
		.readdirSync(originPath, { withFileTypes: true })
		.filter((dirent) => dirent.isFile())
		.filter((dirent) => !dirent.name.startsWith('.')) // Skip hidden files
		.map((dirent) => dirent.name);
}

export function getFileNameWithoutExtension(s: string): string {
	const match = path.basename(s).match(/^([\w-]+)/);

	return match ? match[1] : 'unknown';
}

/**
 * Return shared files path by extension
 * ex: /shared/listeners/log-history.listener.js
 *
 * @param sharedFolder (ex: /shared/listeners)
 * @param extension (ex: listener.js)
 */
export function getSharedFilePathsByExtension(
	sharedFolder: string,
	extension: string,
) {
	const sharedPath = buildSrcPath(sharedFolder);
	const files = listFiles(sharedPath);

	return files
		.filter((f) => f.endsWith(`.${extension}`))
		.map((f) => buildSrcPath(sharedFolder, f));
}

/**
 * This method will pick one file per feature (assuming it exists)
 * ex: /features/<feature>/<feature>.listener.js
 *
 * @param featuresFolder (eg: /features)
 * @param fileExtension (ex: listener.js)
 */
export function getFeaturesFilePathByExtension(
	featuresFolder: string,
	fileExtension: string,
) {
	const featuresPath = buildSrcPath(featuresFolder);
	const features = listDirectories(featuresPath);

	// Assuming each feature has a corresponding listener
	const possibleFiles = features.map((n) =>
		buildSrcPath(featuresFolder, n, `${n}.${fileExtension}`),
	);

	// Return only the actual existing listeners files path
	return possibleFiles.filter((p) => fs.existsSync(p));
}

/**
 * Return multiple files per feature based on a folder and extension
 * ex: /features/<feature>/cron-jobs/<feature>.cron.js
 *
 * @param featuresFolder (eg: /features)
 * @param innerFolder (ex: /cron-jobs)
 * @param fileExtension (ex: cron.js)
 */
export function getFeaturesFilesPathByFolderAndExtension(
	featuresFolder: string,
	innerFolder: string,
	fileExtension: string,
) {
	const featuresPath = buildSrcPath(featuresFolder);
	const features = listDirectories(featuresPath);

	const listFolders = features
		.map((n) => buildSrcPath(featuresFolder, n, innerFolder))
		.filter((p) => fs.existsSync(p));

	return listFolders.flatMap((f) => {
		const files = listFiles(f);

		return files
			.filter((file) => file.endsWith(`.${fileExtension}`))
			.map((file) => path.join(f, file));
	});
}
