import jwt from "jsonwebtoken";
import { pool } from "../../src/v1/config/db.config.js";

export interface TestUser {
    id: string;
    token: string;
    auth: [string, string];
}

// Inserts a user straight into the database and signs a token for it, skipping registration (and its scrypt
// hashing) for tests that are about other endpoints. Import this module after setting SECRET_KEY.
export const createTestUser = async (email: string): Promise<TestUser> => {
    const secretKey = process.env.SECRET_KEY;

    if (!secretKey) {
        throw new Error("Set SECRET_KEY before creating test users");
    }

    const { rows } = await pool.query<{ id: string }>(
        "INSERT INTO users (email, password_hash) VALUES ($1, 'not-a-real-hash') RETURNING id",
        [email]
    );
    const token = jwt.sign({ id: rows[0].id, role: "user" }, secretKey, { algorithm: "HS256", expiresIn: "1h" });

    return { id: rows[0].id, token, auth: ["Authorization", `Bearer ${token}`] };
};
