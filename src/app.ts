import "dotenv/config";
import express from "express";
import cors from "cors";
import { v1Router } from "./v1/v1.routes.js";
import { notFoundMiddleware } from "./v1/middlewares/notFound.middleware.js";
import { errorMiddleware } from "./v1/middlewares/error.middleware.js";

export const app = express();

// do not advertise the framework in every response
app.disable("x-powered-by");

app.use(cors());
// Bodies up to 100 KB everywhere, except document uploads: they can take more than 1 MB as JSON and are
// parsed by their own route, after authentication, so anonymous requests never get a large body read.
const defaultJsonParser = express.json();
app.use((req, res, next) => (req.path.toLowerCase().startsWith("/v1/documents") ? next() : defaultJsonParser(req, res, next)));
app.use(express.urlencoded({ extended: true }));

app.use("/v1", v1Router);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
