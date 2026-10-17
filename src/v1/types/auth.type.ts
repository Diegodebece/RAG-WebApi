import type { User, UserRole } from "./users.type.js";

export interface TokenPayload {
    id: string;
    role: UserRole;
}

// returned by register and login
export interface AuthResult {
    user: User;
    token: string;
}
