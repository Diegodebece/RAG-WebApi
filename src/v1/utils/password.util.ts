import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

// scrypt cost parameters: N (CPU and memory cost), r (block size), p (parallelism).
// They are stored with every hash, so raising them later keeps old passwords verifiable (hashes made before
// with p = 1 still work). N = 2^14, r = 8, p = 5 is one of OWASP's equivalent settings: each hash needs
// 16 MiB (128 * N * r bytes), and p multiplies the work. OWASP's first option, N = 2^17, needs 128 MiB per
// hash, so four logins at once would take the whole 512 MB the container has.
const COST = { N: 16384, r: 8, p: 5 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// node:crypto offers scrypt only with a callback; this wraps it in a promise so callers can use await.
const deriveKey = (password: string, salt: Buffer, keyBytes: number, options: ScryptOptions): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        scrypt(password, salt, keyBytes, options, (error, key) => (error ? reject(error) : resolve(key)));
    });

// The same visible password can arrive in different Unicode forms ("é" as one character, or "e" plus a
// combining accent, depending on the keyboard). NFKC turns them into one form before hashing, as NIST advises.
const normalizePassword = (password: string): string => password.normalize("NFKC");

// Returns "scrypt$N$r$p$salt$hash" (salt and hash in hex), the value stored in users.password_hash.
export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(SALT_BYTES);
    const hash = await deriveKey(normalizePassword(password), salt, KEY_BYTES, COST);

    return ["scrypt", COST.N, COST.r, COST.p, salt.toString("hex"), hash.toString("hex")].join("$");
};

// True when a stored hash was made with other cost parameters than the current ones, so it should be replaced
// the next time its password is known (a successful login).
export const needsRehash = (storedHash: string): boolean => {
    const [, N, r, p] = storedHash.split("$");

    return Number(N) !== COST.N || Number(r) !== COST.r || Number(p) !== COST.p;
};

// Recomputes the hash with the stored salt and parameters. timingSafeEqual takes the same time whether the
// first or the last byte differs, so response times reveal nothing about the hash. A malformed value is false.
export const verifyPassword = async (password: string, storedHash: string): Promise<boolean> => {
    const [algorithm, N, r, p, saltHex, hashHex] = storedHash.split("$");

    if (algorithm !== "scrypt" || !saltHex || !hashHex) {
        return false;
    }

    const expected = Buffer.from(hashHex, "hex");

    if (expected.length === 0) {
        return false;
    }

    const actual = await deriveKey(normalizePassword(password), Buffer.from(saltHex, "hex"), expected.length, {
        N: Number(N),
        r: Number(r),
        p: Number(p)
    });

    return timingSafeEqual(actual, expected);
};
