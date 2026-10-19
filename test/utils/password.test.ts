import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "../../src/v1/utils/password.util.js";

describe("hashPassword", () => {
    it("stores the algorithm, cost parameters, salt and hash", async () => {
        const stored = await hashPassword("correct horse battery staple");
        const [algorithm, N, r, p, salt, hash] = stored.split("$");

        assert.equal(algorithm, "scrypt");
        // OWASP's scrypt setting for 16 MiB of memory: N = 2^14, r = 8, p = 5
        assert.deepEqual([N, r, p], ["16384", "8", "5"]);
        assert.match(salt, /^[0-9a-f]{32}$/);
        assert.match(hash, /^[0-9a-f]{128}$/);
    });

    it("never stores the password itself", async () => {
        assert.ok(!(await hashPassword("my secret password")).includes("my secret password"));
    });

    it("gives the same password a different hash every time, thanks to the random salt", async () => {
        assert.notEqual(await hashPassword("same password"), await hashPassword("same password"));
    });
});

describe("verifyPassword", () => {
    it("accepts the right password and rejects any other", async () => {
        const stored = await hashPassword("correct horse battery staple");

        assert.equal(await verifyPassword("correct horse battery staple", stored), true);
        assert.equal(await verifyPassword("correct horse battery stapler", stored), false);
        assert.equal(await verifyPassword("Correct horse battery staple", stored), false);
    });

    it("handles passwords with spaces and accented letters", async () => {
        const stored = await hashPassword("  contraseña con ñ y tildes áé  ");

        assert.equal(await verifyPassword("  contraseña con ñ y tildes áé  ", stored), true);
        assert.equal(await verifyPassword("contraseña con ñ y tildes áé", stored), false);
    });

    it("accepts the same password typed in another Unicode form", async () => {
        const precomposed = `caf${String.fromCodePoint(0xe9)}`;
        const decomposed = `cafe${String.fromCodePoint(0x301)}`;

        assert.equal(await verifyPassword(decomposed, await hashPassword(precomposed)), true);
        assert.equal(await verifyPassword(precomposed, await hashPassword(decomposed)), true);
    });

    it("still accepts passwords hashed with the earlier cost parameters", async () => {
        const salt = randomBytes(16);
        const hash = scryptSync("old password", salt, 64, { N: 16384, r: 8, p: 1 });
        const stored = ["scrypt", 16384, 8, 1, salt.toString("hex"), hash.toString("hex")].join("$");

        assert.equal(await verifyPassword("old password", stored), true);
        assert.equal(await verifyPassword("other password", stored), false);
    });

    it("rejects values that are not a stored scrypt hash", async () => {
        for (const stored of ["", "plain-text-password", "bcrypt$10$abc", "scrypt$16384$8$1$$", "scrypt$16384$8$1$abcd$zz"]) {
            assert.equal(await verifyPassword("anything", stored), false, stored);
        }
    });
});
