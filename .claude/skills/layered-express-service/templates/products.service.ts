import { AppError } from "../utils/appError.util.js";
import type { Product } from "../types/products.type.js";
import type { CreateProductInput, UpdateProductInput } from "../validators/products.validator.js";

export const getProductsService = async (page: unknown, limit: unknown): Promise<Product[]> => {
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 5;
    const offset = (pageNumber - 1) * limitNumber;

    // DATA ACCESS
    const products = await db.products.findMany({ limit: limitNumber, offset });
    return products;
};

export const getProductByIdService = async (id: number): Promise<Product> => {
    // DATA ACCESS
    const product = await db.products.findById(id);

    if (!product) {
        throw new AppError(404, "Product not found");
    }

    return product;
};

export const createProductService = async (productData: CreateProductInput): Promise<Product> => {
    // DATA ACCESS
    const existingProduct = await db.products.findOne({ name: productData.name });

    if (existingProduct) {
        throw new AppError(409, "A product with that name already exists");
    }

    // DATA ACCESS
    const product = await db.products.create(productData);
    return product;
};

export const updateProductService = async (id: number, productData: UpdateProductInput): Promise<Product> => {
    // DATA ACCESS
    const product = await db.products.findById(id);

    if (!product) {
        throw new AppError(404, "Product not found");
    }

    if (productData.name) {
        // DATA ACCESS
        const existingProduct = await db.products.findOne({ name: productData.name });

        if (existingProduct && existingProduct.id !== id) {
            throw new AppError(409, "A product with that name already exists");
        }
    }

    // DATA ACCESS
    const updatedProduct = await db.products.update(id, productData);
    return updatedProduct;
};

export const deleteProductService = async (id: number): Promise<void> => {
    // DATA ACCESS
    const deletedProduct = await db.products.delete(id);

    if (!deletedProduct) {
        throw new AppError(404, "Product not found");
    }
};
