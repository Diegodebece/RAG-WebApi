import jwt from "jsonwebtoken";
import { TOKEN_ALGORITHM, TOKEN_LIFETIME_SECONDS } from "../config/auth.config.js";
import { isUuid } from "./uuid.util.js";
import type { DecodedToken, TokenPayload } from "../types/auth.type.js";

// the roles a token may carry; keep in sync with the role column of the users table
const ROLES = ["user", "admin"];

// Signing and verifying live together, so the algorithm and the payload shape cannot drift apart.
export const signToken = (payload: TokenPayload, secretKey: string): string =>
    jwt.sign({ id: payload.id, role: payload.role }, secretKey, { algorithm: TOKEN_ALGORITHM, expiresIn: TOKEN_LIFETIME_SECONDS });

// The payload of a valid token, or null for anything else: a bad signature, another algorithm (alg: none
// included), an expired token, a token without an expiry (it would never expire), or a correctly signed
// token whose payload does not have the expected shape.
export const verifyToken = (token: string, secretKey: string): DecodedToken | null => {
    let decoded: string | jwt.JwtPayload;

    try {
        decoded = jwt.verify(token, secretKey, { algorithms: [TOKEN_ALGORITHM] });
    } catch {
        return null;
    }

    if (typeof decoded !== "object" || typeof decoded.exp !== "number" || typeof decoded.id !== "string" || !isUuid(decoded.id)) {
        return null;
    }

    const role: unknown = decoded.role;

    if (typeof role !== "string" || !ROLES.includes(role)) {
        return null;
    }

    return { id: decoded.id, role, expiresAt: decoded.exp * 1000 };
};
