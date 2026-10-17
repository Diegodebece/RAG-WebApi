import { app } from "./app.js";
import { getStartupConfigProblems } from "./v1/config/env.config.js";

const PORT = Number(process.env.PORT) || 3000;

// 127.0.0.1 keeps the API reachable from this computer only; inside Docker HOST must be 0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";

const problems = getStartupConfigProblems(process.env);

if (problems.length > 0) {
    console.error(`Cannot start the server:\n- ${problems.join("\n- ")}`);
    process.exit(1);
}

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});
