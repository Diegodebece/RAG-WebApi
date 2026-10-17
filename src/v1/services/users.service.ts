import { pool } from "../config/db.config.js";
import { AppError } from "../utils/appError.util.js";
import type { User } from "../types/users.type.js";

const USER_COLUMNS = `id, email, role, created_at AS "createdAt"`;

// A valid token can outlive its account (for example after the account is deleted), hence the 404.
export const getCurrentUserService = async (userId: string): Promise<User> => {
    const { rows } = await pool.query<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [userId]);

    if (rows.length === 0) {
        throw new AppError(404, "User not found");
    }

    return rows[0];
};
