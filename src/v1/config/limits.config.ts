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

const MINUTE_MS = 60 * 1000;

export const REGISTRATION_WINDOW_MS = 60 * MINUTE_MS;

export const LOGIN_WINDOW_MS = 15 * MINUTE_MS;

// accounts actually created per address
export const REGISTRATIONS_PER_HOUR = readPositiveInteger("REGISTRATIONS_PER_HOUR", 3);

// every registration request per address, failed ones included, so a taken email (409) cannot be
// probed without limit to find out who has an account
export const REGISTRATION_ATTEMPTS_PER_HOUR = readPositiveInteger("REGISTRATION_ATTEMPTS_PER_HOUR", 20);

export const LOGINS_PER_15_MINUTES = readPositiveInteger("LOGINS_PER_15_MINUTES", 10);

export const FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = readPositiveInteger("FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES", 5);

// how long a login token stays valid
export const TOKEN_LIFETIME_SECONDS = readPositiveInteger("TOKEN_LIFETIME_SECONDS", 3600);
