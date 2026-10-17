// The only algorithm tokens are signed and verified with.
export const TOKEN_ALGORITHM = "HS256";

// Read on every call instead of once at import: server.ts refuses to start without a proper value, and tests
// change it at run time. Returns undefined when it is missing, so callers can answer with a 500.
export const getSecretKey = (): string | undefined => process.env.SECRET_KEY || undefined;
