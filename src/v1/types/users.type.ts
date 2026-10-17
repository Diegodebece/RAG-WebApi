export type UserRole = "user" | "admin";

// what the API returns about a user; never includes the password hash
export interface User {
    id: string;
    email: string;
    role: UserRole;
    createdAt: Date;
}

// only for checking a password at login; must never be returned
export interface UserRecord extends User {
    passwordHash: string;
}
