import express from "express";
import { streamEvents } from "../controllers/events.controller.js";

export const eventsRouter = express.Router({ mergeParams: true });

eventsRouter.get("/", streamEvents);
