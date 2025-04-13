import { db } from '../config/database.js';

export const StockMovementController = {
    async createMovement(req, res, next) {
        try {
            const { productId, quantity, type, referenceId, notes } = req.body;

            if (!productId || !quantity || !type) {
                const error = new Error('Product ID, quantity and type are required');
                error.statusCode = 400;
                throw error;
            }

            if (!['STOCK_IN', 'SALE', 'REMOVAL'].includes(type)) {
                const error = new Error('Type must be one of: STOCK_IN, SALE, REMOVAL');
                error.statusCode = 400;
                throw error;
            }


            await db.run('BEGIN TRANSACTION');


            const product = await db.get(
                `SELECT * FROM product WHERE id = ?`,
                [productId]
            );

            if (!product) {
                await db.run('ROLLBACK');
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            let newQuantity;

            if (type === 'STOCK_IN') {
                newQuantity = product.quantity + quantity;
            } else {
                newQuantity = product.quantity - quantity;

                if (newQuantity < 0) {
                    await db.run('ROLLBACK');
                    const error = new Error('Insufficient stock');
                    error.statusCode = 400;
                    throw error;
                }
            }

            const movementResult = await db.run(
                `INSERT INTO stock_movement (product_id, quantity, type, reference_id, notes)
                VALUES (?, ?, ?, ?, ?)`,
                [productId, quantity, type, referenceId, notes]
            );


            await db.run(
                `UPDATE product 
                SET quantity = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [newQuantity, productId]
            );


            await db.run('COMMIT');

            const newMovement = await db.get(
                `SELECT * FROM stock_movement WHERE id = ?`,
                [movementResult.lastID]
            );

            res.status(201).json({
                movement: newMovement,
                product: { ...product, quantity: newQuantity }
            });
        } catch (error) {
            await db.run('ROLLBACK').catch(() => { });
            next(error);
        }
    },

    async getProductMovements(req, res, next) {
        try {
            const { productId } = req.params;

            const product = await db.get(
                `SELECT * FROM product WHERE id = ?`,
                [productId]
            );

            if (!product) {
                const error = new Error('Product not found');
                error.statusCode = 404;
                throw error;
            }

            const movements = await db.all(
                `SELECT * FROM stock_movement 
                WHERE product_id = ? 
                ORDER BY created_at DESC`,
                [productId]
            );

            res.json({
                product,
                movements
            });
        } catch (error) {
            next(error);
        }
    }
};