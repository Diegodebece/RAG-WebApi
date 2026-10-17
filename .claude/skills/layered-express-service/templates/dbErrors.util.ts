// PostgreSQL error code for a duplicate value in a unique column or index
const UNIQUE_VIOLATION = "23505";

export const isUniqueViolation = (error: unknown): boolean =>
    error instanceof Error && "code" in error && error.code === UNIQUE_VIOLATION;
