import express from "express";
import { authenticateMiddleware } from "./middlewares/authenticate.middleware.js";
import { authRouter } from "./routes/auth.routes.js";
import { productsRouter } from "./routes/products.routes.js";

export const v1Router = express.Router({ mergeParams: true });

// public routes
v1Router.use("/auth", authRouter);

v1Router.use(authenticateMiddleware);

// protected routes
v1Router.use("/products", productsRouter);
