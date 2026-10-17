import { pool } from "../config/db.config.js";
import { DAILY_LIMIT_WINDOW_HOURS, MAX_DOCUMENTS_PER_USER, MAX_QUESTIONS_PER_DAY, MAX_UPLOADS_PER_DAY } from "../config/limits.config.js";
import { AppError } from "../utils/appError.util.js";
import type { CurrentUser, User } from "../types/users.type.js";

// the columns of a User, shared with the auth service so both always return the same shape
export const USER_COLUMNS = `id, email, role, created_at AS "createdAt"`;

// A valid token can outlive its account (for example after the account is deleted), hence the 404.
export const getCurrentUserService = async (userId: string): Promise<CurrentUser> => {
    const { rows } = await pool.query<User & { documentCount: number; uploadCount: number; questionCount: number }>(
        `SELECT ${USER_COLUMNS},
                (SELECT count(*)::int FROM documents WHERE user_id = users.id) AS "documentCount",
                (SELECT count(*)::int FROM upload_usage
                 WHERE user_id = users.id AND uploaded_at > now() - make_interval(hours => $2)) AS "uploadCount",
                (SELECT count(*)::int FROM question_usage
                 WHERE user_id = users.id AND asked_at > now() - make_interval(hours => $2)) AS "questionCount"
         FROM users WHERE id = $1`,
        [userId, DAILY_LIMIT_WINDOW_HOURS]
    );

    if (rows.length === 0) {
        throw new AppError(404, "User not found");
    }

    const { documentCount, uploadCount, questionCount, ...user } = rows[0];

    return {
        ...user,
        usage: {
            documents: { used: documentCount, limit: MAX_DOCUMENTS_PER_USER },
            uploadsToday: { used: uploadCount, limit: MAX_UPLOADS_PER_DAY },
            questionsToday: { used: questionCount, limit: MAX_QUESTIONS_PER_DAY }
        }
    };
};
