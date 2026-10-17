import "dotenv/config";
import express from "express";
import cors from "cors";
import { CORS_ORIGINS, TRUSTED_PROXIES } from "./v1/config/server.config.js";
import { v1Router } from "./v1/v1.routes.js";
import { securityHeadersMiddleware } from "./v1/middlewares/securityHeaders.middleware.js";
import { notFoundMiddleware } from "./v1/middlewares/notFound.middleware.js";
import { errorMiddleware } from "./v1/middlewares/error.middleware.js";

export const app = express();

// do not advertise the framework in every response
app.disable("x-powered-by");

// req.ip is the real client address only for requests that come through a trusted proxy (see server.config.ts)
app.set("trust proxy", TRUSTED_PROXIES);

app.use(securityHeadersMiddleware);
app.use(cors(CORS_ORIGINS.length > 0 ? { origin: CORS_ORIGINS } : undefined));
// No global body parser: each route that takes a body parses it with express.json(), after authentication
// and the per-address rate limits, so rejected requests never get their body read.

app.use("/v1", v1Router);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
