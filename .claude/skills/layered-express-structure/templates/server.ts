import { app } from "./app.js";

const PORT = Number(process.env.PORT) || 3000;

// 127.0.0.1 keeps the API reachable from this computer only; inside Docker HOST must be 0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});
