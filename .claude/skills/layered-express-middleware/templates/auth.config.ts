// The only algorithm tokens are signed and verified with.
export const TOKEN_ALGORITHM = "HS256";

// How long a token stays valid. A project with a limits config may keep this value there instead.
export const TOKEN_LIFETIME_SECONDS = Number(process.env.TOKEN_LIFETIME_SECONDS) || 3600;

// Read on every call instead of once at import, so tests can change it at run time.
// Returns undefined when it is missing, so callers can answer with a 500.
export const getSecretKey = (): string | undefined => process.env.SECRET_KEY || undefined;
