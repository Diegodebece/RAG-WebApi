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

// failed logins per email and address (see emailAndIpKey in rateLimit.middleware.ts)
export const FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = readPositiveInteger("FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES", 5);

// how long a login token stays valid
export const TOKEN_LIFETIME_SECONDS = readPositiveInteger("TOKEN_LIFETIME_SECONDS", 3600);

export const MAX_DOCUMENTS_PER_USER = readPositiveInteger("MAX_DOCUMENTS_PER_USER", 3);

// accepted uploads per user in the last 24 hours; deleting a document does not give an upload back
export const MAX_UPLOADS_PER_DAY = readPositiveInteger("MAX_UPLOADS_PER_DAY", 3);

// the rolling window of the daily limits (uploads now, questions later)
export const DAILY_LIMIT_WINDOW_HOURS = 24;

// about 60 Word pages; checked on the text the browser sends, before it is cleaned
export const MAX_DOCUMENT_CHARS = readPositiveInteger("MAX_DOCUMENT_CHARS", 200000);

// queued and running jobs of all users together; one Ollama job runs at a time
export const MAX_QUEUED_JOBS = readPositiveInteger("MAX_QUEUED_JOBS", 20);

// documents (with their chunks and jobs) are deleted after this many hours
export const DOCUMENT_LIFETIME_HOURS = readPositiveInteger("DOCUMENT_LIFETIME_HOURS", 24);

// upload and question records only matter for the daily limits, so they are kept for one window
export const USAGE_RETENTION_HOURS = DAILY_LIMIT_WINDOW_HOURS;

export const CLEANUP_INTERVAL_MS = 10 * MINUTE_MS;
