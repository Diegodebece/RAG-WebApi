import express from "express";
import { getHealth } from "../controllers/health.controller.js";

export const healthRouter = express.Router({ mergeParams: true });

healthRouter.get("/", getHealth);
