import type { Request, Response, NextFunction } from "express";
import { loginUserService, registerUserService } from "../services/auth.service.js";
import type { LoginUserInput, RegisterUserInput } from "../validators/auth.validator.js";

export const registerUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user, token } = await registerUserService(req.validatedBody as RegisterUserInput);
        return res.status(201).json({ success: true, message: "User registered successfully", data: user, token });
    } catch (error) {
        next(error);
    }
};

export const loginUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user, token } = await loginUserService(req.validatedBody as LoginUserInput);
        return res.status(200).json({ success: true, message: "Logged in successfully", data: user, token });
    } catch (error) {
        next(error);
    }
};
