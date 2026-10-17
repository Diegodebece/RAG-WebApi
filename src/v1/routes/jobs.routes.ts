import express from "express";
import { getJobById } from "../controllers/jobs.controller.js";

export const jobsRouter = express.Router({ mergeParams: true });

jobsRouter.get("/:id", getJobById);
