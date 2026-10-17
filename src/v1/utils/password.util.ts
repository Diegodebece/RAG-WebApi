import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

// scrypt cost parameters: N (CPU and memory cost), r (block size), p (parallelism).
// They are stored with every hash, so raising them later keeps old passwords verifiable.
const COST = { N: 16384, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 64;

// node:crypto offers scrypt only with a callback; this wraps it in a promise so callers can use await.
const deriveKey = (password: string, salt: Buffer, keyBytes: number, options: ScryptOptions): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        scrypt(password, salt, keyBytes, options, (error, key) => (error ? reject(error) : resolve(key)));
    });

// Returns "scrypt$N$r$p$salt$hash" (salt and hash in hex), the value stored in users.password_hash.
export const hashPassword = async (password: string): Promise<string> => {
    const salt = randomBytes(SALT_BYTES);
    const hash = await deriveKey(password, salt, KEY_BYTES, COST);

    return ["scrypt", COST.N, COST.r, COST.p, salt.toString("hex"), hash.toString("hex")].join("$");
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

    const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length, {
        N: Number(N),
        r: Number(r),
        p: Number(p)
    });

    return timingSafeEqual(actual, expected);
};
