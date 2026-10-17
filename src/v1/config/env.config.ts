// A token signed with a short or well-known secret can be forged by guessing the secret offline.
const MIN_SECRET_KEY_LENGTH = 32;

// Settings the server cannot run safely without. server.ts refuses to start while any problem is listed,
// instead of failing on the first request or running with a guessable secret.
export const getStartupConfigProblems = (env: NodeJS.ProcessEnv): string[] => {
    const problems: string[] = [];
    const secretKey = env.SECRET_KEY ?? "";

    if (secretKey === "") {
        problems.push("SECRET_KEY is not set");
    } else if (secretKey === "change-me" || secretKey.length < MIN_SECRET_KEY_LENGTH) {
        problems.push(`SECRET_KEY must be a random value of at least ${MIN_SECRET_KEY_LENGTH} characters`);
    }

    return problems;
};

// Reads an integer setting from .env. A missing value uses the default; anything that is not a whole number
// from min to max stops the app at startup, instead of running with a setting that breaks it later (a negative
// timeout, for example, would make every Ollama request fail).
export const readIntegerSetting = (name: string, defaultValue: number, min = 1, max = Number.MAX_SAFE_INTEGER): number => {
    const raw = process.env[name];

    if (raw === undefined || raw.trim() === "") {
        return defaultValue;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value < min || value > max) {
        const range = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `from ${min} to ${max}`;
        throw new Error(`${name} must be a whole number ${range}`);
    }

    return value;
};

// Reads a comma-separated list from .env, such as "https://a.example, https://b.example".
export const readListSetting = (name: string, defaultValue: string[] = []): string[] => {
    const items = (process.env[name] ?? "").split(",").map((item) => item.trim()).filter((item) => item !== "");
    return items.length > 0 ? items : defaultValue;
};
