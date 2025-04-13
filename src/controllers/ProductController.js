import { db } from '../config/database.js';

export const ProductController = {
    async getAllProducts(req, res, next) {
        try {
            const storeId = req.query.storeId || 1;

            const products = await db.all(
                `SELECT * FROM product WHERE store_id = ? ORDER BY name`,
                [storeId]
            );

            res.json(products);
        } catch (error) {
            next(error);
        }
    },

    async getProductById(req, res, next) {
        try {
            const { id } = req.params;

            const product = await db.get(
                `SELECT * FROM product WHERE id = ?`,
                [id]
            );

            if (!product) {
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            res.json(product);
        } catch (error) {
            next(error);
        }
    },

    async createProduct(req, res, next) {
        try {
            const { name, sku, description, price, quantity = 0, storeId = 1 } = req.body;

            if (!name || !price) {
                const error = new Error('Name and price are required');
                error.statusCode = 400;
                throw error;
            }

            const result = await db.run(
                `INSERT INTO product (name, sku, description, price, quantity, store_id)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [name, sku, description, price, quantity, storeId]
            );

            const newProduct = await db.get(
                `SELECT * FROM product WHERE id = ?`,
                [result.lastID]
            );

            res.status(201).json(newProduct);
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                error.message = 'A product with this SKU already exists';
                error.statusCode = 400;
            }
            next(error);
        }
    },

    async updateProduct(req, res, next) {
        try {
            const { id } = req.params;
            const { name, sku, description, price } = req.body;

            const product = await db.get(`SELECT * FROM product WHERE id = ?`, [id]);

            if (!product) {
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            await db.run(
                `UPDATE product 
                SET name = ?, sku = ?, description = ?, price = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [
                    name || product.name,
                    sku || product.sku,
                    description !== undefined ? description : product.description,
                    price || product.price,
                    id
                ]
            );

            const updatedProduct = await db.get(`SELECT * FROM product WHERE id = ?`, [id]);
            res.json(updatedProduct);
        } catch (error) {
            next(error);
        }
    },

    async deleteProduct(req, res, next) {
        try {
            const { id } = req.params;

            const product = await db.get(`SELECT * FROM product WHERE id = ?`, [id]);

            if (!product) {
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            await db.run(`DELETE FROM product WHERE id = ?`, [id]);

            res.json({ message: 'Product deleted successfully' });
        } catch (error) {
            next(error);
        }
    }
};