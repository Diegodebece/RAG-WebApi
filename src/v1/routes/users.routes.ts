import express from "express";
import { getCurrentUser } from "../controllers/users.controller.js";

export const usersRouter = express.Router({ mergeParams: true });

usersRouter.get("/me", getCurrentUser);
