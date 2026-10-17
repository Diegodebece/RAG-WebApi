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
