import express from "express";
import { getProducts, getProductById, createProduct, updateProduct, deleteProduct } from "../controllers/products.controller.js";
import { authorizeMiddleware } from "../middlewares/authorize.middleware.js";
import { validateBodyMiddleware } from "../middlewares/validateBody.middleware.js";
import { createProductSchema, updateProductSchema } from "../validators/products.validator.js";

export const productsRouter = express.Router({ mergeParams: true });

productsRouter.get("/", getProducts);
productsRouter.get("/:id", getProductById);
productsRouter.post("/", authorizeMiddleware(["admin"]), validateBodyMiddleware(createProductSchema), createProduct);
productsRouter.patch("/:id", authorizeMiddleware(["admin"]), validateBodyMiddleware(updateProductSchema), updateProduct);
productsRouter.delete("/:id", authorizeMiddleware(["admin"]), deleteProduct);
