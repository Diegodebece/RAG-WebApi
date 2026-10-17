export type UserRole = "user" | "admin";

// what the API returns about a user; never includes the password hash
export interface User {
    id: string;
    email: string;
    role: UserRole;
    createdAt: Date;
}

// GET /users/me: the account plus how much of each quota it uses
export interface CurrentUser extends User {
    usage: {
        documents: { used: number; limit: number };
        uploadsToday: { used: number; limit: number };
        questionsToday: { used: number; limit: number };
    };
}

// only for checking a password at login; must never be returned
export interface UserRecord extends User {
    passwordHash: string;
}
