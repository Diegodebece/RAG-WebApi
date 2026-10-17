import { pool } from "../config/db.config.js";
import { MAX_DOCUMENTS_PER_USER } from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import type { CurrentUser, User } from "../types/users.type.js";

const USER_COLUMNS = `id, email, role, created_at AS "createdAt"`;

// A valid token can outlive its account (for example after the account is deleted), hence the 404.
export const getCurrentUserService = async (userId: string): Promise<CurrentUser> => {
    const { rows } = await pool.query<User & { documentCount: number }>(
        `SELECT ${USER_COLUMNS}, (SELECT count(*)::int FROM documents WHERE user_id = users.id) AS "documentCount"
         FROM users WHERE id = $1`,
        [userId]
    );

    if (rows.length === 0) {
        throw new AppError(404, "User not found");
    }

    const { documentCount, ...user } = rows[0];

    return { ...user, usage: { documents: { used: documentCount, limit: MAX_DOCUMENTS_PER_USER } } };
};
