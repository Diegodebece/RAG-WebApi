import Joi from "joi";

export interface RegisterUserInput {
    email: string;
    password: string;
}

export interface LoginUserInput {
    email: string;
    password: string;
}

// Normalized to NFC, trimmed and lowercased, so an address is stored and compared one way only:
// "josé" typed as one character or as "e" plus a combining accent is the same account.
const emailRule = Joi.string().normalize("NFC").trim().lowercase().email().max(254).required().messages({
    "string.base": "Email must be a string",
    "string.empty": "Email cannot be empty",
    "string.email": "Email must be a valid email address",
    "string.max": "Email cannot have more than {#limit} characters",
    "any.required": "Email is required"
});

// Passwords are not trimmed: spaces are valid characters. Length matters more than character rules.
export const registerUserSchema = Joi.object<RegisterUserInput>({
    email: emailRule,
    password: Joi.string().min(8).max(64).required().messages({
        "string.base": "Password must be a string",
        "string.empty": "Password cannot be empty",
        "string.min": "Password must have at least {#limit} characters",
        "string.max": "Password cannot have more than {#limit} characters",
        "any.required": "Password is required"
    })
});

// No minimum here: login only checks the password, it does not enforce the policy again.
export const loginUserSchema = Joi.object<LoginUserInput>({
    email: emailRule,
    password: Joi.string().max(64).required().messages({
        "string.base": "Password must be a string",
        "string.empty": "Password cannot be empty",
        "string.max": "Password cannot have more than {#limit} characters",
        "any.required": "Password is required"
    })
});
