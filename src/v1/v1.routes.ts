import express from "express";
import { authenticateMiddleware } from "./middlewares/authenticate.middleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";
import { usersRouter } from "./routes/users.routes.js";

export const v1Router = express.Router({ mergeParams: true });

// public routes
v1Router.use("/health", healthRouter);
v1Router.use("/auth", authRouter);

v1Router.use(authenticateMiddleware);

// protected routes
v1Router.use("/users", usersRouter);
v1Router.use("/documents", documentsRouter);
v1Router.use("/jobs", jobsRouter);
