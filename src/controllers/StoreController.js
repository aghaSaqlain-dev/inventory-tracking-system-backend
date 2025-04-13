import { db } from '../config/database.js';

export const StoreController = {
    /**
     * Get all stores with optional filtering and pagination
     */
    async getAllStores(req, res, next) {
        try {
            const { page = 1, limit = 20, search } = req.query;
            const offset = (page - 1) * limit;

            let query = 'SELECT * FROM store';
            let countQuery = 'SELECT COUNT(*) FROM store';
            let params = [];

            // Add search if provided
            if (search) {
                query += ' WHERE name ILIKE $1 OR address ILIKE $1';
                countQuery += ' WHERE name ILIKE $1 OR address ILIKE $1';
                params.push(`%${search}%`);
            }

            // Add sorting and pagination
            query += ' ORDER BY name LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);

            // Execute queries
            const stores = await db.query(query, [...params, limit, offset]);
            const countResult = await db.query(countQuery, params);

            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                stores: stores.rows,
                pagination: {
                    total,
                    totalPages,
                    currentPage: parseInt(page),
                    limit: parseInt(limit)
                }
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get a single store by ID
     */
    async getStoreById(req, res, next) {
        try {
            const { id } = req.params;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Get store details
            const storeResult = await db.query(
                'SELECT * FROM store WHERE id = $1',
                [id]
            );

            if (storeResult.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            const store = storeResult.rows[0];

            // Get store inventory summary
            const inventorySummary = await db.query(
                `SELECT 
          COUNT(DISTINCT product_id) as product_count,
          SUM(quantity) as total_items,
          SUM(quantity * COALESCE(price, (SELECT base_price FROM product_catalog WHERE id = product_id))) as total_value
        FROM store_inventory
        WHERE store_id = $1`,
                [id]
            );

            // Get recent stock movements
            const recentMovements = await db.query(
                `SELECT 
          sm.*,
          pc.name as product_name,
          pc.sku
        FROM stock_movement sm
        JOIN product_catalog pc ON sm.product_id = pc.id
        WHERE sm.store_id = $1
        ORDER BY sm.created_at DESC
        LIMIT 5`,
                [id]
            );

            res.json({
                ...store,
                inventory_summary: {
                    product_count: parseInt(inventorySummary.rows[0].product_count) || 0,
                    total_items: parseInt(inventorySummary.rows[0].total_items) || 0,
                    total_value: parseFloat(inventorySummary.rows[0].total_value) || 0
                },
                recent_movements: recentMovements.rows
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Create a new store
     */
    async createStore(req, res, next) {
        try {
            const { name, address, phone } = req.body;

            // Validate required fields
            if (!name) {
                return res.status(400).json({ error: 'Store name is required' });
            }

            // Create new store
            const result = await db.query(
                `INSERT INTO store (name, address, phone, created_at, updated_at) 
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
         RETURNING *`,
                [name, address, phone]
            );

            res.status(201).json({
                message: 'Store created successfully',
                store: result.rows[0]
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update an existing store
     */
    async updateStore(req, res, next) {
        try {
            const { id } = req.params;
            const { name, address, phone } = req.body;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Check if store exists
            const storeCheck = await db.query(
                'SELECT * FROM store WHERE id = $1',
                [id]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            const existingStore = storeCheck.rows[0];

            // Update store
            const result = await db.query(
                `UPDATE store
         SET 
           name = $1,
           address = $2,
           phone = $3,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
                [
                    name || existingStore.name,
                    address !== undefined ? address : existingStore.address,
                    phone !== undefined ? phone : existingStore.phone,
                    id
                ]
            );

            res.json({
                message: 'Store updated successfully',
                store: result.rows[0]
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Delete a store
     */
    async deleteStore(req, res, next) {
        try {
            const { id } = req.params;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Check if store exists
            const storeCheck = await db.query(
                'SELECT * FROM store WHERE id = $1',
                [id]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            // Check if store has inventory or movement records
            const inventoryCheck = await db.query(
                'SELECT id FROM store_inventory WHERE store_id = $1 LIMIT 1',
                [id]
            );

            if (inventoryCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Cannot delete store with existing inventory records',
                    message: 'Please remove all inventory records first'
                });
            }

            const movementCheck = await db.query(
                'SELECT id FROM stock_movement WHERE store_id = $1 LIMIT 1',
                [id]
            );

            if (movementCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Cannot delete store with existing stock movement records',
                    message: 'This store has transaction history that cannot be removed'
                });
            }

            // Delete the store
            await db.query('DELETE FROM store WHERE id = $1', [id]);

            res.json({
                message: 'Store deleted successfully'
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get store performance metrics
     */
    async getStoreMetrics(req, res, next) {
        try {
            const { id } = req.params;
            const { startDate, endDate } = req.query;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Validate date range if provided
            let dateFilter = '';
            let params = [id];

            if (startDate && endDate) {
                params.push(startDate, endDate);
                dateFilter = 'AND created_at BETWEEN $2 AND $3';
            }

            // Check if store exists
            const storeCheck = await db.query(
                'SELECT id, name FROM store WHERE id = $1',
                [id]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            // Get sales metrics
            const salesMetrics = await db.query(
                `SELECT 
          COUNT(*) as transaction_count,
          SUM(quantity) as units_sold,
          SUM(quantity * (
            SELECT COALESCE(si.price, pc.base_price) 
            FROM store_inventory si 
            JOIN product_catalog pc ON si.product_id = pc.id 
            WHERE si.store_id = sm.store_id AND si.product_id = sm.product_id
          )) as total_sales
        FROM stock_movement sm
        WHERE store_id = $1 AND type = 'SALE' ${dateFilter}`,
                params
            );

            // Get inventory turnover
            // Average inventory value during period
            const inventoryValue = await db.query(
                `SELECT 
          AVG(value) as avg_inventory_value
        FROM (
          SELECT 
            SUM(quantity * COALESCE(price, (SELECT base_price FROM product_catalog WHERE id = product_id))) as value
          FROM store_inventory 
          WHERE store_id = $1
        ) as inventory_value`,
                [id]
            );

            // Get stock movement summary by type
            const movementSummary = await db.query(
                `SELECT 
          type,
          COUNT(*) as count,
          SUM(quantity) as total_quantity
        FROM stock_movement
        WHERE store_id = $1 ${dateFilter}
        GROUP BY type`,
                params
            );

            // Get top selling products
            const topProducts = await db.query(
                `SELECT 
          pc.id,
          pc.name,
          pc.sku,
          SUM(sm.quantity) as total_quantity,
          SUM(sm.quantity * COALESCE(si.price, pc.base_price)) as total_sales
        FROM stock_movement sm
        JOIN product_catalog pc ON sm.product_id = pc.id
        LEFT JOIN store_inventory si ON sm.store_id = si.store_id AND sm.product_id = si.product_id
        WHERE sm.store_id = $1 AND sm.type = 'SALE' ${dateFilter}
        GROUP BY pc.id, pc.name, pc.sku
        ORDER BY total_quantity DESC
        LIMIT 5`,
                params
            );

            // Format the metrics
            const metrics = {
                store: storeCheck.rows[0],
                period: {
                    start_date: startDate || null,
                    end_date: endDate || null
                },
                sales: {
                    transaction_count: parseInt(salesMetrics.rows[0].transaction_count) || 0,
                    units_sold: parseInt(salesMetrics.rows[0].units_sold) || 0,
                    total_sales: parseFloat(salesMetrics.rows[0].total_sales) || 0
                },
                inventory: {
                    current_value: parseFloat(inventoryValue.rows[0].avg_inventory_value) || 0,
                    turnover_ratio: salesMetrics.rows[0].total_sales && inventoryValue.rows[0].avg_inventory_value ?
                        parseFloat(salesMetrics.rows[0].total_sales) / parseFloat(inventoryValue.rows[0].avg_inventory_value) : 0
                },
                movements: movementSummary.rows.reduce((acc, movement) => {
                    acc[movement.type.toLowerCase()] = {
                        count: parseInt(movement.count),
                        quantity: parseInt(movement.total_quantity)
                    };
                    return acc;
                }, {}),
                top_products: topProducts.rows.map(product => ({
                    ...product,
                    total_sales: parseFloat(product.total_sales) || 0
                }))
            };

            res.json(metrics);
        } catch (error) {
            next(error);
        }
    }
};