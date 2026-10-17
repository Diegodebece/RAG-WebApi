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
