import { randomBytes } from "node:crypto";
import { pool } from "../config/db.config.js";
import { getSecretKey } from "../config/auth.config.js";
import { AppError } from "../utils/appError.util.js";
import { isUniqueViolation } from "../utils/dbErrors.util.js";
import { hashPassword, verifyPassword } from "../utils/password.util.js";
import { signToken } from "../utils/token.util.js";
import { USER_COLUMNS } from "./users.service.js";
import type { AuthResult } from "../types/auth.type.js";
import type { User, UserRecord } from "../types/users.type.js";
import type { LoginUserInput, RegisterUserInput } from "../validators/auth.validator.js";

const EMAIL_TAKEN_MESSAGE = "Email is already registered";

// the same message for an unknown email and a wrong password, so login does not reveal which accounts exist
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

// Checked against when the email does not exist, so that case takes as long as a wrong password.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(16).toString("hex"));

// server.ts refuses to start without a proper SECRET_KEY; this guards code paths that run without server.ts.
const requireSecretKey = (): string => {
    const secretKey = getSecretKey();

    if (!secretKey) {
        throw new Error("SECRET_KEY is not set");
    }

    return secretKey;
};

export const registerUserService = async (userData: RegisterUserInput): Promise<AuthResult> => {
    // read first, so a missing secret fails before the account is created, not after
    const secretKey = requireSecretKey();
    const { rows: existing } = await pool.query("SELECT 1 FROM users WHERE lower(email) = lower($1)", [userData.email]);

    if (existing.length > 0) {
        throw new AppError(409, EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(userData.password);
    let user: User;

    try {
        const { rows } = await pool.query<User>(
            `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING ${USER_COLUMNS}`,
            [userData.email, passwordHash]
        );
        user = rows[0];
    } catch (error) {
        // another request registered the same email between the check and the insert
        if (isUniqueViolation(error)) {
            throw new AppError(409, EMAIL_TAKEN_MESSAGE);
        }
        throw error;
    }

    return { user, token: signToken(user, secretKey) };
};

export const loginUserService = async (loginData: LoginUserInput): Promise<AuthResult> => {
    const { rows } = await pool.query<UserRecord>(
        `SELECT ${USER_COLUMNS}, password_hash AS "passwordHash" FROM users WHERE lower(email) = lower($1)`,
        [loginData.email]
    );
    const record = rows[0];

    if (!record) {
        await verifyPassword(loginData.password, await DUMMY_PASSWORD_HASH);
        throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
    }

    if (!(await verifyPassword(loginData.password, record.passwordHash))) {
        throw new AppError(401, INVALID_CREDENTIALS_MESSAGE);
    }

    const user: User = { id: record.id, email: record.email, role: record.role, createdAt: record.createdAt };
    return { user, token: signToken(user, requireSecretKey()) };
};
