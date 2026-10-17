import { describe, it } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "../../src/v1/utils/token.util.js";
import { TOKEN_LIFETIME_SECONDS } from "../../src/v1/config/limits.config.js";
import type { TokenPayload } from "../../src/v1/types/auth.type.js";

const SECRET = "test-secret-only-for-these-tests";
const payload: TokenPayload = { id: "3f2b8c1e-9a4d-4e7f-b2c1-8d5e6f7a9b0c", role: "admin" };

describe("signToken", () => {
    it("signs only the id and the role, with HS256 and the configured lifetime", () => {
        const token = signToken({ ...payload, email: "ana@example.com" } as TokenPayload, SECRET);
        const { header, payload: claims } = jwt.decode(token, { complete: true }) as jwt.Jwt & { payload: jwt.JwtPayload };

        assert.equal(header.alg, "HS256");
        assert.deepEqual(Object.keys(claims).sort(), ["exp", "iat", "id", "role"]);
        assert.equal((claims.exp ?? 0) - (claims.iat ?? 0), TOKEN_LIFETIME_SECONDS);
    });
});

describe("verifyToken", () => {
    it("returns the payload of a token made by signToken", () => {
        assert.deepEqual(verifyToken(signToken(payload, SECRET), SECRET), payload);
    });

    it("returns null for a token signed with another secret", () => {
        assert.equal(verifyToken(signToken(payload, "another-secret"), SECRET), null);
    });

    it("returns null for a correctly signed token with an unexpected payload", () => {
        assert.equal(verifyToken(jwt.sign({ id: "not-a-uuid", role: "user" }, SECRET), SECRET), null);
        assert.equal(verifyToken(jwt.sign({ id: payload.id, role: "root" }, SECRET), SECRET), null);
    });
});
