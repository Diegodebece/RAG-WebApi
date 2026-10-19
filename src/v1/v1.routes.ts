import express from "express";
import { AUTHENTICATED_REQUEST_WINDOW_MS, AUTHENTICATED_REQUESTS_PER_MINUTE } from "./config/limits.config.js";
import { authenticateMiddleware } from "./middlewares/authenticate.middleware.js";
import { rateLimitMiddleware } from "./middlewares/rateLimit.middleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { eventsRouter } from "./routes/events.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";
import { usersRouter } from "./routes/users.routes.js";

export const v1Router = express.Router({ mergeParams: true });

// public routes
v1Router.use("/health", healthRouter);
v1Router.use("/auth", authRouter);

v1Router.use(authenticateMiddleware);

// one counter per user for every protected route, on top of each route's own limits
v1Router.use(rateLimitMiddleware({ limit: AUTHENTICATED_REQUESTS_PER_MINUTE, windowMs: AUTHENTICATED_REQUEST_WINDOW_MS, keyBy: "user" }));

// protected routes
v1Router.use("/users", usersRouter);
v1Router.use("/documents", documentsRouter);
v1Router.use("/jobs", jobsRouter);
v1Router.use("/events", eventsRouter);
