import { db } from '../config/database.js';

export const StoreController = {
    async getAllStores(req, res, next) {
        try {
            const stores = await db.all(`SELECT * FROM store ORDER BY name`);
            res.json(stores);
        } catch (error) {
            next(error);
        }
    },

    async getStoreById(req, res, next) {
        try {
            const { id } = req.params;

            const store = await db.get(
                `SELECT * FROM store WHERE id = ?`,
                [id]
            );

            if (!store) {
                const error = new Error('Store not found');
                error.statusCode = 404;
                throw error;
            }

            res.json(store);
        } catch (error) {
            next(error);
        }
    },

    async createStore(req, res, next) {
        try {
            const { name, address, phone } = req.body;

            if (!name) {
                const error = new Error('Store name is required');
                error.statusCode = 400;
                throw error;
            }

            const result = await db.run(
                `INSERT INTO store (name, address, phone)
                VALUES (?, ?, ?)`,
                [name, address, phone]
            );

            const newStore = await db.get(
                `SELECT * FROM store WHERE id = ?`,
                [result.lastID]
            );

            res.status(201).json(newStore);
        } catch (error) {
            next(error);
        }
    },

    async updateStore(req, res, next) {
        try {
            const { id } = req.params;
            const { name, address, phone } = req.body;

            const store = await db.get(`SELECT * FROM store WHERE id = ?`, [id]);

            if (!store) {
                const error = new Error('Store not found');
                error.statusCode = 404;
                throw error;
            }

            await db.run(
                `UPDATE store 
                SET name = ?, address = ?, phone = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [
                    name || store.name,
                    address !== undefined ? address : store.address,
                    phone !== undefined ? phone : store.phone,
                    id
                ]
            );

            const updatedStore = await db.get(`SELECT * FROM store WHERE id = ?`, [id]);
            res.json(updatedStore);
        } catch (error) {
            next(error);
        }
    }
};