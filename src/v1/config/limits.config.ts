// Limits agreed for the proof of concept; each one can be overridden in .env.

// A missing value uses the default; a value that is not a positive integer stops the app at startup.
const readPositiveInteger = (name: string, defaultValue: number): number => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") {
        return defaultValue;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }

    return value;
};

export const REGISTRATIONS_PER_HOUR = readPositiveInteger("REGISTRATIONS_PER_HOUR", 3);

export const LOGINS_PER_15_MINUTES = readPositiveInteger("LOGINS_PER_15_MINUTES", 10);

export const FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = readPositiveInteger("FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES", 5);
