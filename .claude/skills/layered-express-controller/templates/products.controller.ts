import type { Request, Response, NextFunction } from "express";
import { getProductsService, getProductByIdService, createProductService, updateProductService, deleteProductService } from "../services/products.service.js";
import type { CreateProductInput, UpdateProductInput } from "../validators/products.validator.js";

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page, limit } = req.query;
        const products = await getProductsService(page, limit);
        return res.status(200).json({ success: true, message: "Products retrieved successfully", data: products });
    } catch (error) {
        next(error);
    }
};

export const getProductById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        const product = await getProductByIdService(id);
        return res.status(200).json({ success: true, message: "Product retrieved successfully", data: product });
    } catch (error) {
        next(error);
    }
};

export const createProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const product = await createProductService(req.validatedBody as CreateProductInput);
        return res.status(201).json({ success: true, message: "Product created successfully", data: product });
    } catch (error) {
        next(error);
    }
};

export const updateProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        const product = await updateProductService(id, req.validatedBody as UpdateProductInput);
        return res.status(200).json({ success: true, message: "Product updated successfully", data: product });
    } catch (error) {
        next(error);
    }
};

export const deleteProduct = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = Number(req.params.id);
        await deleteProductService(id);
        return res.status(200).json({ success: true, message: "Product deleted successfully" });
    } catch (error) {
        next(error);
    }
};
