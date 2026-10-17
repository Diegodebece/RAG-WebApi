import { pool } from "../config/db.config.js";
import { AppError } from "../utils/appError.util.js";
import { isUniqueViolation } from "../utils/dbErrors.util.js";
import type { Product } from "../types/products.type.js";
import type { CreateProductInput, UpdateProductInput } from "../validators/products.validator.js";

// The columns returned to clients, renamed to the Product type's camelCase names.
const PRODUCT_COLUMNS = `id, name, description, price::float8 AS price, status, category_id AS "categoryId"`;

const DUPLICATE_NAME_MESSAGE = "A product with that name already exists";

export const getProductsService = async (page: unknown, limit: unknown): Promise<Product[]> => {
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 5;
    const offset = (pageNumber - 1) * limitNumber;

    const { rows } = await pool.query<Product>(
        `SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name LIMIT $1 OFFSET $2`,
        [limitNumber, offset]
    );
    return rows;
};

export const getProductByIdService = async (id: string): Promise<Product> => {
    const { rows } = await pool.query<Product>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);

    if (rows.length === 0) {
        throw new AppError(404, "Product not found");
    }

    return rows[0];
};

export const createProductService = async (productData: CreateProductInput): Promise<Product> => {
    const { rows: existing } = await pool.query("SELECT 1 FROM products WHERE lower(name) = lower($1)", [productData.name]);

    if (existing.length > 0) {
        throw new AppError(409, DUPLICATE_NAME_MESSAGE);
    }

    try {
        const { rows } = await pool.query<Product>(
            `INSERT INTO products (name, description, price, status, category_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING ${PRODUCT_COLUMNS}`,
            [productData.name, productData.description ?? null, productData.price, productData.status ?? "active", productData.categoryId]
        );
        return rows[0];
    } catch (error) {
        // another request inserted the same name between the check and the insert
        if (isUniqueViolation(error)) {
            throw new AppError(409, DUPLICATE_NAME_MESSAGE);
        }
        throw error;
    }
};

export const updateProductService = async (id: string, productData: UpdateProductInput): Promise<Product> => {
    if (productData.name) {
        const { rows: existing } = await pool.query(
            "SELECT 1 FROM products WHERE lower(name) = lower($1) AND id <> $2",
            [productData.name, id]
        );

        if (existing.length > 0) {
            throw new AppError(409, DUPLICATE_NAME_MESSAGE);
        }
    }

    try {
        // COALESCE keeps the current value for every field the PATCH did not send
        const { rows } = await pool.query<Product>(
            `UPDATE products SET
                 name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 price = COALESCE($4, price),
                 status = COALESCE($5, status),
                 category_id = COALESCE($6, category_id)
             WHERE id = $1
             RETURNING ${PRODUCT_COLUMNS}`,
            [
                id,
                productData.name ?? null,
                productData.description ?? null,
                productData.price ?? null,
                productData.status ?? null,
                productData.categoryId ?? null
            ]
        );

        if (rows.length === 0) {
            throw new AppError(404, "Product not found");
        }

        return rows[0];
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new AppError(409, DUPLICATE_NAME_MESSAGE);
        }
        throw error;
    }
};

export const deleteProductService = async (id: string): Promise<void> => {
    const { rows } = await pool.query("DELETE FROM products WHERE id = $1 RETURNING id", [id]);

    if (rows.length === 0) {
        throw new AppError(404, "Product not found");
    }
};
