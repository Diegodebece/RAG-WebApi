import Joi from "joi";

export interface CreateProductInput {
    name: string;
    description?: string;
    price: number;
    status?: "active" | "inactive";
    categoryId: number;
}

export type UpdateProductInput = Partial<CreateProductInput>;

export const createProductSchema = Joi.object<CreateProductInput>({
    name: Joi.string().trim().min(3).max(100).required().messages({
        "string.base": "Name must be a string",
        "string.empty": "Name cannot be empty",
        "string.min": "Name must have at least {#limit} characters",
        "string.max": "Name cannot have more than {#limit} characters",
        "any.required": "Name is required"
    }),
    description: Joi.string().trim().max(500).messages({
        "string.base": "Description must be a string",
        "string.max": "Description cannot have more than {#limit} characters"
    }),
    price: Joi.number().positive().precision(2).required().messages({
        "number.base": "Price must be a number",
        "number.positive": "Price must be greater than 0",
        "number.precision": "Price can have at most {#limit} decimals",
        "any.required": "Price is required"
    }),
    status: Joi.string().valid("active", "inactive").messages({
        "any.only": "Status must be 'active' or 'inactive'"
    }),
    categoryId: Joi.number().integer().positive().required().messages({
        "number.base": "Category id must be a number",
        "number.integer": "Category id must be an integer",
        "number.positive": "Category id must be positive",
        "any.required": "Category id is required"
    })
});

export const updateProductSchema = createProductSchema
    .fork(["name", "price", "categoryId"], (field) => field.optional())
    .min(1)
    .messages({
        "object.min": "At least one field must be provided"
    });
