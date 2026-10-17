import jwt from "jsonwebtoken";
import { TOKEN_ALGORITHM } from "../config/auth.config.js";
import { TOKEN_LIFETIME_SECONDS } from "../config/limits.config.js";
import { isUuid } from "./uuid.util.js";
import type { TokenPayload } from "../types/auth.type.js";
import type { UserRole } from "../types/users.type.js";

const ROLES: UserRole[] = ["user", "admin"];

// Signing and verifying live together, so the algorithm and the payload shape cannot drift apart.
export const signToken = (payload: TokenPayload, secretKey: string): string =>
    jwt.sign({ id: payload.id, role: payload.role }, secretKey, { algorithm: TOKEN_ALGORITHM, expiresIn: TOKEN_LIFETIME_SECONDS });

// The payload of a valid token, or null for anything else: a bad signature, another algorithm (alg: none
// included), an expired token, or a correctly signed token whose payload does not have the expected shape.
export const verifyToken = (token: string, secretKey: string): TokenPayload | null => {
    let decoded: string | jwt.JwtPayload;

    try {
        decoded = jwt.verify(token, secretKey, { algorithms: [TOKEN_ALGORITHM] });
    } catch {
        return null;
    }

    if (typeof decoded !== "object" || typeof decoded.id !== "string" || !isUuid(decoded.id)) {
        return null;
    }

    const role: unknown = decoded.role;

    if (typeof role !== "string" || !ROLES.includes(role as UserRole)) {
        return null;
    }

    return { id: decoded.id, role: role as UserRole };
};
