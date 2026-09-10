import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { Configuration } from '@/config/settings.config';
import { getClientIp } from '@/helpers/system.helper';

/**
 * An address in the only form the database stores it: keyed, one-way, fixed length.
 *
 * Keyed rather than a bare digest, because IPv4 is 2^32 values - an unkeyed SHA-256 of an address
 * is reversible by enumerating the space, which makes the stored column personal data in a thin
 * disguise. The key comes from `security.ipHashSecret`.
 *
 * @param {string} ip - The address to hash
 * @returns {string} - Hex digest, the value stored in a `user_ip_hash` column
 */
export function hashIp(ip: string): string {
	return crypto
		.createHmac('sha256', Configuration.get('security.ipHashSecret'))
		.update(ip)
		.digest('hex');
}

/**
 * The requester's hashed address, or `null` when no address can be resolved.
 *
 * Callers must reject that request rather than fall back to a constant: every unresolvable caller
 * would hash alike and share one identity, and on `rating` that means one vote between all of them.
 *
 * @param {Request} req - The request whose origin address should be hashed
 * @returns {string | null} - Hex digest, or null when the address is unknown
 */
export function hashClientIp(req: Request): string | null {
	const ip = getClientIp(req);

	if (ip === 'n/a') {
		return null;
	}

	return hashIp(ip);
}

/**
 * Encrypts a password using bcrypt.
 *
 * @param {string} password - The plaintext value supplied by the caller
 */
export async function encryptPassword(password: string): Promise<string> {
	return await bcrypt.hash(password, 10);
}

/**
 * Constant-time comparison of a plaintext secret against a bcrypt hash.
 *
 * @param {string} password - The plaintext value supplied by the caller
 * @param {string} hashedPassword - The stored bcrypt hash
 * @returns {Promise<boolean>} - True when the two match
 */
export async function comparePassword(
	password: string,
	hashedPassword: string,
): Promise<boolean> {
	return await bcrypt.compare(password, hashedPassword);
}

/**
 * Whether `provided` equals any entry of `accepted`, in time independent of where the
 * first difference falls.
 *
 * Both sides are SHA-256'd before the comparison. That is not for secrecy - the digests
 * are of values this process already holds - but because `timingSafeEqual` throws on
 * operands of different lengths, and a bare length check would leak the key's length
 * through the fast path. Digesting makes every operand 32 bytes, so the comparison itself
 * is the only thing that runs.
 *
 * Every entry is compared even after a match, so the time taken does not reveal which key
 * of the list matched.
 *
 * The `codeql` marker below silences `js/insufficient-password-hash`, which reads any digest of
 * a caller-supplied credential as password storage. Nothing is stored here - the digests live
 * for the length of one comparison - and the secret is a machine-generated deployment key, so a
 * KDF's work factor would only add cost to a check that runs on every request, ahead of the body
 * parsers.
 *
 * @param {string} provided - The value supplied by the caller
 * @param {readonly string[]} accepted - The keys this deployment honors
 * @returns {boolean} - True when one of them matches
 */
export function matchesAnySecret(
	provided: string,
	accepted: readonly string[],
): boolean {
	const providedDigest = crypto
		.createHash('sha256')
		.update(provided) // codeql[js/insufficient-password-hash]
		.digest();

	return accepted.reduce((matched, candidate) => {
		const candidateDigest = crypto
			.createHash('sha256')
			.update(candidate)
			.digest();

		return crypto.timingSafeEqual(providedDigest, candidateDigest)
			? true
			: matched;
	}, false);
}
