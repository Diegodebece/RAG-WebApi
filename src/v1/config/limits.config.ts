import { readIntegerSetting } from "./env.config.js";

// Limits agreed for the proof of concept; each one can be overridden in .env (a value that is not a positive
// integer stops the app at startup).

const MINUTE_MS = 60 * 1000;

export const REGISTRATION_WINDOW_MS = 60 * MINUTE_MS;

export const LOGIN_WINDOW_MS = 15 * MINUTE_MS;

// accounts actually created per address
export const REGISTRATIONS_PER_HOUR = readIntegerSetting("REGISTRATIONS_PER_HOUR", 3);

// every registration request per address, failed ones included, so a taken email (409) cannot be
// probed without limit to find out who has an account
export const REGISTRATION_ATTEMPTS_PER_HOUR = readIntegerSetting("REGISTRATION_ATTEMPTS_PER_HOUR", 20);

export const LOGINS_PER_15_MINUTES = readIntegerSetting("LOGINS_PER_15_MINUTES", 10);

// failed logins per email and address (see emailAndIpKey in rateLimit.middleware.ts)
export const FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES = readIntegerSetting("FAILED_LOGINS_PER_EMAIL_PER_15_MINUTES", 5);

// how long a login token stays valid
export const TOKEN_LIFETIME_SECONDS = readIntegerSetting("TOKEN_LIFETIME_SECONDS", 3600);

export const MAX_DOCUMENTS_PER_USER = readIntegerSetting("MAX_DOCUMENTS_PER_USER", 3);

// upload requests per user per minute, counted in memory before the body is read, accepted or not
export const UPLOAD_REQUESTS_PER_MINUTE = readIntegerSetting("UPLOAD_REQUESTS_PER_MINUTE", 5);

export const UPLOAD_WINDOW_MS = MINUTE_MS;

// accepted uploads per user in the last 24 hours; deleting a document does not give an upload back
export const MAX_UPLOADS_PER_DAY = readIntegerSetting("MAX_UPLOADS_PER_DAY", 3);

// the rolling window of the daily limits (uploads and questions)
export const DAILY_LIMIT_WINDOW_HOURS = 24;

// questions per user per minute, counted in memory by rateLimitMiddleware
export const QUESTIONS_PER_MINUTE = readIntegerSetting("QUESTIONS_PER_MINUTE", 10);

export const QUESTION_WINDOW_MS = MINUTE_MS;

// accepted questions per user in the last 24 hours
export const MAX_QUESTIONS_PER_DAY = readIntegerSetting("MAX_QUESTIONS_PER_DAY", 30);

// a question is embedded and sent to the model whole
export const MAX_QUESTION_CHARS = 1000;

// The longest a question may take in total: waiting for its turn with the model, embedding and answering. Past
// it the API answers 503 (still waiting) or 504 (the model was answering), and the question goes back to the
// daily quota. It stays well under the 100 seconds after which Cloudflare cuts a response.
export const MAX_QUESTION_SECONDS = readIntegerSetting("MAX_QUESTION_SECONDS", 60);

// questions of all users waiting for the model at the same time; more get a 503 right away
export const MAX_WAITING_QUESTIONS = readIntegerSetting("MAX_WAITING_QUESTIONS", 20);

// about 60 Word pages; checked on the text the browser sends, before it is cleaned
export const MAX_DOCUMENT_CHARS = readIntegerSetting("MAX_DOCUMENT_CHARS", 200000);

// open event streams (GET /v1/events) per user, for example two browser tabs, and for all users together
export const MAX_EVENT_STREAMS_PER_USER = readIntegerSetting("MAX_EVENT_STREAMS_PER_USER", 2);

export const MAX_EVENT_STREAMS = readIntegerSetting("MAX_EVENT_STREAMS", 30);

// open event streams from one client address, so a few accounts from one place cannot take every stream
export const MAX_EVENT_STREAMS_PER_ADDRESS = readIntegerSetting("MAX_EVENT_STREAMS_PER_ADDRESS", 4);

// an event stream sends a comment this often, so proxies and the browser do not close an idle connection
export const EVENT_STREAM_HEARTBEAT_SECONDS = readIntegerSetting("EVENT_STREAM_HEARTBEAT_SECONDS", 25);

// queued and running jobs of all users together; one Ollama job runs at a time
export const MAX_QUEUED_JOBS = readIntegerSetting("MAX_QUEUED_JOBS", 20);

// documents (with their chunks and jobs) are deleted after this many hours
export const DOCUMENT_LIFETIME_HOURS = readIntegerSetting("DOCUMENT_LIFETIME_HOURS", 24);

// upload and question records only matter for the daily limits, so they are kept for one window
export const USAGE_RETENTION_HOURS = DAILY_LIMIT_WINDOW_HOURS;

export const CLEANUP_INTERVAL_MS = 10 * MINUTE_MS;

// health checks per client address per minute; the endpoint is public
export const HEALTH_CHECKS_PER_MINUTE = readIntegerSetting("HEALTH_CHECKS_PER_MINUTE", 30);

export const HEALTH_WINDOW_MS = MINUTE_MS;

// how long a health report is reused before the database and Ollama are checked again (0: every time)
export const HEALTH_CACHE_SECONDS = readIntegerSetting("HEALTH_CACHE_SECONDS", 10, 0);
