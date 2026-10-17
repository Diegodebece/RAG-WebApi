import type { User, UserRole } from "./users.type.js";

// what a token carries
export interface TokenPayload {
    id: string;
    role: UserRole;
}

// what authenticateMiddleware puts in req.decoded: the payload, plus when the token expires (milliseconds
// since 1970), which ends the user's event streams
export interface DecodedToken extends TokenPayload {
    expiresAt: number;
}

// returned by register and login
export interface AuthResult {
    user: User;
    token: string;
}
