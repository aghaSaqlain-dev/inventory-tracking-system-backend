import { db } from '../config/database.js';

export const InventoryController = {
    /**
     * Get inventory for a specific store
     */
    async getStoreInventory(req, res, next) {
        try {
            const { storeId } = req.params;
            const {
                page = 1,
                limit = 20,
                minQuantity,
                maxQuantity,
                category
            } = req.query;

            if (!storeId || isNaN(parseInt(storeId))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Check if store exists
            const storeCheck = await db.query(
                'SELECT id, name FROM store WHERE id = $1',
                [storeId]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            const store = storeCheck.rows[0];
            const offset = (page - 1) * limit;

            // Build query with filters
            let queryParams = [storeId];
            let filterConditions = [];
            let queryBase = `
        SELECT 
          si.id as inventory_id, 
          si.quantity, 
          si.price, 
          pc.id as product_id, 
          pc.name as product_name, 
          pc.sku, 
          pc.description,
          pc.category,
          pc.base_price
        FROM store_inventory si
        JOIN product_catalog pc ON si.product_id = pc.id
        WHERE si.store_id = $1
      `;

            // Add quantity filters
            if (minQuantity !== undefined) {
                queryParams.push(parseInt(minQuantity));
                filterConditions.push(`si.quantity >= $${queryParams.length}`);
            }

            if (maxQuantity !== undefined) {
                queryParams.push(parseInt(maxQuantity));
                filterConditions.push(`si.quantity <= $${queryParams.length}`);
            }

            // Add category filter
            if (category) {
                queryParams.push(category);
                filterConditions.push(`pc.category = $${queryParams.length}`);
            }

            // Add filter conditions to query
            if (filterConditions.length > 0) {
                queryBase += ' AND ' + filterConditions.join(' AND ');
            }

            // Count query (for pagination)
            const countQuery = `
        SELECT COUNT(*) FROM (${queryBase}) as filtered_inventory
      `;

            // Final query with sorting and pagination
            const query = `
        ${queryBase}
        ORDER BY pc.name
        LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
      `;

            queryParams.push(parseInt(limit), parseInt(offset));

            // Execute queries
            const countResult = await db.query(countQuery, queryParams.slice(0, queryParams.length - 2));
            const result = await db.query(query, queryParams);

            // Calculate total value of inventory
            let totalValue = 0;
            result.rows.forEach(item => {
                totalValue += (item.price || item.base_price) * item.quantity;
            });

            // Calculate total pages
            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                store,
                inventory: result.rows,
                summary: {
                    totalItems: total,
                    totalValue: parseFloat(totalValue.toFixed(2)),
                    lowStockCount: 0 // This could be calculated with a threshold
                },
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
     * Get inventory for a specific product across all stores
     */
    async getProductInventory(req, res, next) {
        try {
            const { productId } = req.params;

            if (!productId || isNaN(parseInt(productId))) {
                return res.status(400).json({ error: 'Valid product ID is required' });
            }

            // Check if product exists
            const productCheck = await db.query(
                'SELECT * FROM product_catalog WHERE id = $1',
                [productId]
            );

            if (productCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const product = productCheck.rows[0];

            // Get inventory across all stores
            const inventoryResult = await db.query(
                `SELECT 
          si.id as inventory_id,
          si.store_id,
          s.name as store_name,
          si.quantity,
          si.price,
          si.created_at,
          si.updated_at
        FROM store_inventory si
        JOIN store s ON si.store_id = s.id
        WHERE si.product_id = $1
        ORDER BY s.name`,
                [productId]
            );

            // Calculate totals
            const totalQuantity = inventoryResult.rows.reduce((sum, item) => sum + item.quantity, 0);
            const totalStores = inventoryResult.rows.length;

            res.json({
                product,
                inventory: inventoryResult.rows,
                summary: {
                    totalQuantity,
                    totalStores,
                    averagePrice: totalStores > 0 ?
                        inventoryResult.rows.reduce((sum, item) => sum + (item.price || product.base_price), 0) / totalStores :
                        product.base_price
                }
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update inventory quantity and price
     */
    async updateInventory(req, res, next) {
        try {
            const { inventoryId } = req.params;
            const { quantity, price } = req.body;

            if (!inventoryId || isNaN(parseInt(inventoryId))) {
                return res.status(400).json({ error: 'Valid inventory ID is required' });
            }

            // Check if inventory record exists
            const inventoryCheck = await db.query(
                `SELECT 
          si.*, 
          pc.name as product_name, 
          s.name as store_name
        FROM store_inventory si
        JOIN product_catalog pc ON si.product_id = pc.id
        JOIN store s ON si.store_id = s.id
        WHERE si.id = $1`,
                [inventoryId]
            );

            if (inventoryCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Inventory record not found' });
            }

            const currentInventory = inventoryCheck.rows[0];

            // Start transaction
            await db.query('BEGIN');

            try {
                // Update inventory record
                const result = await db.query(
                    `UPDATE store_inventory
           SET 
             quantity = COALESCE($1, quantity),
             price = COALESCE($2, price),
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING *`,
                    [
                        quantity !== undefined ? quantity : currentInventory.quantity,
                        price !== undefined ? price : currentInventory.price,
                        inventoryId
                    ]
                );

                // If quantity changed, record it as a stock movement
                if (quantity !== undefined && quantity !== currentInventory.quantity) {
                    const changeAmount = quantity - currentInventory.quantity;
                    const movementType = changeAmount > 0 ? 'STOCK_IN' : 'REMOVAL';

                    await db.query(
                        `INSERT INTO stock_movement
             (store_id, product_id, quantity, type, notes)
             VALUES ($1, $2, $3, $4, $5)`,
                        [
                            currentInventory.store_id,
                            currentInventory.product_id,
                            Math.abs(changeAmount),
                            movementType,
                            `Manual inventory adjustment by ${req.user?.name || 'system'}`
                        ]
                    );
                }

                // Commit transaction
                await db.query('COMMIT');

                res.json({
                    message: 'Inventory updated successfully',
                    inventory: {
                        ...result.rows[0],
                        product_name: currentInventory.product_name,
                        store_name: currentInventory.store_name
                    }
                });
            } catch (error) {
                await db.query('ROLLBACK');
                throw error;
            }
        } catch (error) {
            next(error);
        }
    },

    /**
     * Create a stock movement (stock-in, sale, removal, transfer)
     */
    async createStockMovement(req, res, next) {
        try {
            const {
                storeId,
                productId,
                quantity,
                type,
                referenceId,
                notes,
                destinationStoreId // For transfers only
            } = req.body;

            // Validate required fields
            if (!storeId || !productId || !quantity || !type) {
                return res.status(400).json({
                    error: 'Store ID, product ID, quantity, and movement type are required'
                });
            }

            // Validate movement type
            const validTypes = ['STOCK_IN', 'SALE', 'REMOVAL', 'TRANSFER'];
            if (!validTypes.includes(type)) {
                return res.status(400).json({
                    error: `Movement type must be one of: ${validTypes.join(', ')}`
                });
            }

            // For transfers, validate destination store
            if (type === 'TRANSFER' && !destinationStoreId) {
                return res.status(400).json({
                    error: 'Destination store ID is required for transfers'
                });
            }

            // Validate quantity
            if (quantity <= 0) {
                return res.status(400).json({ error: 'Quantity must be greater than zero' });
            }

            // Start transaction
            await db.query('BEGIN');

            try {
                // Check if product exists
                const productCheck = await db.query(
                    'SELECT * FROM product_catalog WHERE id = $1',
                    [productId]
                );

                if (productCheck.rows.length === 0) {
                    await db.query('ROLLBACK');
                    return res.status(404).json({ error: 'Product not found' });
                }

                // Check if store exists
                const storeCheck = await db.query(
                    'SELECT * FROM store WHERE id = $1',
                    [storeId]
                );

                if (storeCheck.rows.length === 0) {
                    await db.query('ROLLBACK');
                    return res.status(404).json({ error: 'Store not found' });
                }

                // For transfers, check destination store
                if (type === 'TRANSFER') {
                    const destStoreCheck = await db.query(
                        'SELECT * FROM store WHERE id = $1',
                        [destinationStoreId]
                    );

                    if (destStoreCheck.rows.length === 0) {
                        await db.query('ROLLBACK');
                        return res.status(404).json({ error: 'Destination store not found' });
                    }
                }

                // Get or create inventory record for source store
                let sourceInventory = await db.query(
                    'SELECT * FROM store_inventory WHERE store_id = $1 AND product_id = $2',
                    [storeId, productId]
                );

                if (sourceInventory.rows.length === 0) {
                    // Create new inventory record
                    const newInventory = await db.query(
                        `INSERT INTO store_inventory 
             (store_id, product_id, quantity, price)
             VALUES ($1, $2, 0, $3)
             RETURNING *`,
                        [storeId, productId, productCheck.rows[0].base_price]
                    );

                    sourceInventory = { rows: [newInventory.rows[0]] };
                }

                const currentQuantity = sourceInventory.rows[0].quantity;

                // For outgoing movements, check if enough stock
                if (['SALE', 'REMOVAL', 'TRANSFER'].includes(type) && currentQuantity < quantity) {
                    await db.query('ROLLBACK');
                    return res.status(400).json({
                        error: 'Insufficient stock',
                        available: currentQuantity,
                        requested: quantity
                    });
                }

                // Create stock movement record
                const movementResult = await db.query(
                    `INSERT INTO stock_movement
           (store_id, product_id, quantity, type, reference_id, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
                    [storeId, productId, quantity, type, referenceId, notes]
                );

                // Update source store inventory
                let newSourceQuantity;
                if (type === 'STOCK_IN') {
                    newSourceQuantity = currentQuantity + quantity;
                } else {
                    newSourceQuantity = currentQuantity - quantity;
                }

                await db.query(
                    `UPDATE store_inventory
           SET quantity = $1, updated_at = CURRENT_TIMESTAMP
           WHERE store_id = $2 AND product_id = $3`,
                    [newSourceQuantity, storeId, productId]
                );

                // For transfers, update destination store inventory
                if (type === 'TRANSFER') {
                    // Get or create inventory record for destination store
                    let destInventory = await db.query(
                        'SELECT * FROM store_inventory WHERE store_id = $1 AND product_id = $2',
                        [destinationStoreId, productId]
                    );

                    let destQuantity = 0;

                    if (destInventory.rows.length === 0) {
                        // Create new inventory record
                        const newDestInventory = await db.query(
                            `INSERT INTO store_inventory 
               (store_id, product_id, quantity, price)
               VALUES ($1, $2, 0, $3)
               RETURNING *`,
                            [destinationStoreId, productId, sourceInventory.rows[0].price || productCheck.rows[0].base_price]
                        );

                        destInventory = { rows: [newDestInventory.rows[0]] };
                    } else {
                        destQuantity = destInventory.rows[0].quantity;
                    }

                    // Update destination quantity
                    await db.query(
                        `UPDATE store_inventory
             SET quantity = $1, updated_at = CURRENT_TIMESTAMP
             WHERE store_id = $2 AND product_id = $3`,
                        [destQuantity + quantity, destinationStoreId, productId]
                    );

                    // Create complementary movement record for destination
                    await db.query(
                        `INSERT INTO stock_movement
             (store_id, product_id, quantity, type, reference_id, notes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            destinationStoreId,
                            productId,
                            quantity,
                            'STOCK_IN',
                            referenceId || movementResult.rows[0].id.toString(),
                            `Transfer from Store #${storeId} - ${notes || ''}`
                        ]
                    );
                }

                // Commit transaction
                await db.query('COMMIT');

                res.status(201).json({
                    message: 'Stock movement created successfully',
                    movement: movementResult.rows[0],
                    inventory: {
                        store_id: storeId,
                        product_id: productId,
                        new_quantity: newSourceQuantity
                    }
                });
            } catch (error) {
                await db.query('ROLLBACK');
                throw error;
            }
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get all stock movements with pagination and filtering
     */
    async getStockMovements(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                startDate,
                endDate,
                type,
                productId,
                storeId
            } = req.query;

            const offset = (page - 1) * limit;
            let params = [];
            let whereConditions = [];

            // Build WHERE conditions
            if (startDate) {
                params.push(startDate);
                whereConditions.push(`sm.created_at >= $${params.length}`);
            }

            if (endDate) {
                params.push(endDate);
                whereConditions.push(`sm.created_at <= $${params.length}`);
            }

            if (type) {
                params.push(type);
                whereConditions.push(`sm.type = $${params.length}`);
            }

            if (productId) {
                params.push(productId);
                whereConditions.push(`sm.product_id = $${params.length}`);
            }

            if (storeId) {
                params.push(storeId);
                whereConditions.push(`sm.store_id = $${params.length}`);
            }

            // Build query
            let queryBase = `
        SELECT 
          sm.*,
          pc.name as product_name,
          pc.sku,
          s.name as store_name
        FROM stock_movement sm
        JOIN product_catalog pc ON sm.product_id = pc.id
        JOIN store s ON sm.store_id = s.id
      `;

            if (whereConditions.length > 0) {
                queryBase += ` WHERE ${whereConditions.join(' AND ')}`;
            }

            // Count query
            const countQuery = `SELECT COUNT(*) FROM (${queryBase}) as filtered_movements`;

            // Final query with sorting and pagination
            const query = `
        ${queryBase}
        ORDER BY sm.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

            params.push(parseInt(limit), parseInt(offset));

            // Execute queries
            const countResult = await db.query(countQuery, params.slice(0, params.length - 2));
            const result = await db.query(query, params);

            // Calculate total pages
            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                movements: result.rows,
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
     * Get stock movements for a specific store
     */
    async getStoreMovements(req, res, next) {
        try {
            const { storeId } = req.params;
            const {
                page = 1,
                limit = 20,
                startDate,
                endDate,
                type
            } = req.query;

            if (!storeId || isNaN(parseInt(storeId))) {
                return res.status(400).json({ error: 'Valid store ID is required' });
            }

            // Check if store exists
            const storeCheck = await db.query(
                'SELECT id, name FROM store WHERE id = $1',
                [storeId]
            );

            if (storeCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Store not found' });
            }

            // Update req.query to include storeId for the getStockMovements method
            req.query = { ...req.query, storeId };

            // Reuse the getStockMovements method
            return await this.getStockMovements(req, res, next);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get stock movements for a specific product
     */
    async getProductMovements(req, res, next) {
        try {
            const { productId } = req.params;
            const {
                page = 1,
                limit = 20,
                startDate,
                endDate,
                type
            } = req.query;

            if (!productId || isNaN(parseInt(productId))) {
                return res.status(400).json({ error: 'Valid product ID is required' });
            }

            // Check if product exists
            const productCheck = await db.query(
                'SELECT id, name FROM product_catalog WHERE id = $1',
                [productId]
            );

            if (productCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Update req.query to include productId for the getStockMovements method
            req.query = { ...req.query, productId };

            // Reuse the getStockMovements method
            return await this.getStockMovements(req, res, next);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get inventory report across all stores
     */
    async getInventoryReport(req, res, next) {
        try {
            const { storeId, category, lowStockThreshold = 10 } = req.query;

            let params = [];
            let whereConditions = [];
            let queryBase = `
        SELECT 
          pc.id as product_id,
          pc.name as product_name,
          pc.sku,
          pc.category,
          s.id as store_id,
          s.name as store_name,
          si.quantity,
          si.price,
          pc.base_price
        FROM store_inventory si
        JOIN product_catalog pc ON si.product_id = pc.id
        JOIN store s ON si.store_id = s.id
      `;

            // Add filters
            if (storeId) {
                params.push(storeId);
                whereConditions.push(`s.id = $${params.length}`);
            }

            if (category) {
                params.push(category);
                whereConditions.push(`pc.category = $${params.length}`);
            }

            if (whereConditions.length > 0) {
                queryBase += ` WHERE ${whereConditions.join(' AND ')}`;
            }

            // Execute query
            const result = await db.query(queryBase, params);

            // Calculate summaries
            let totalValue = 0;
            let totalItems = 0;
            let lowStockCount = 0;

            result.rows.forEach(item => {
                const itemValue = (item.price || item.base_price) * item.quantity;
                totalValue += itemValue;
                totalItems += item.quantity;

                if (item.quantity <= lowStockThreshold) {
                    lowStockCount++;
                }
            });

            // Group by store
            const storeGroups = {};
            result.rows.forEach(item => {
                if (!storeGroups[item.store_id]) {
                    storeGroups[item.store_id] = {
                        store_id: item.store_id,
                        store_name: item.store_name,
                        total_items: 0,
                        total_value: 0,
                        low_stock_count: 0,
                        product_count: 0
                    };
                }

                storeGroups[item.store_id].product_count++;
                storeGroups[item.store_id].total_items += item.quantity;
                storeGroups[item.store_id].total_value += (item.price || item.base_price) * item.quantity;

                if (item.quantity <= lowStockThreshold) {
                    storeGroups[item.store_id].low_stock_count++;
                }
            });

            // Group by category
            const categoryGroups = {};
            result.rows.forEach(item => {
                const category = item.category || 'Uncategorized';

                if (!categoryGroups[category]) {
                    categoryGroups[category] = {
                        category,
                        total_items: 0,
                        total_value: 0,
                        product_count: 0
                    };
                }

                categoryGroups[category].product_count++;
                categoryGroups[category].total_items += item.quantity;
                categoryGroups[category].total_value += (item.price || item.base_price) * item.quantity;
            });

            res.json({
                summary: {
                    total_value: parseFloat(totalValue.toFixed(2)),
                    total_items: totalItems,
                    product_count: result.rows.length,
                    store_count: Object.keys(storeGroups).length,
                    category_count: Object.keys(categoryGroups).length,
                    low_stock_count: lowStockCount
                },
                by_store: Object.values(storeGroups).map(store => ({
                    ...store,
                    total_value: parseFloat(store.total_value.toFixed(2))
                })),
                by_category: Object.values(categoryGroups).map(cat => ({
                    ...cat,
                    total_value: parseFloat(cat.total_value.toFixed(2))
                })),
                low_stock_items: result.rows
                    .filter(item => item.quantity <= lowStockThreshold)
                    .sort((a, b) => a.quantity - b.quantity)
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get stock movement report with aggregations
     */
    async getMovementReport(req, res, next) {
        try {
            const {
                startDate,
                endDate,
                storeId,
                groupBy = 'date' // 'date', 'store', 'product', 'type'
            } = req.query;

            if (!startDate || !endDate) {
                return res.status(400).json({ error: 'Start date and end date are required' });
            }

            let params = [startDate, endDate];
            let whereConditions = [`sm.created_at >= $1`, `sm.created_at <= $2`];

            if (storeId) {
                params.push(storeId);
                whereConditions.push(`sm.store_id = $${params.length}`);
            }

            // Base query
            let queryBase = `
        SELECT 
          sm.id,
          sm.store_id,
          s.name as store_name,
          sm.product_id,
          pc.name as product_name,
          pc.sku,
          sm.quantity,
          sm.type,
          sm.reference_id,
          sm.created_at,
          pc.base_price,
          si.price
        FROM stock_movement sm
        JOIN product_catalog pc ON sm.product_id = pc.id
        JOIN store s ON sm.store_id = s.id
        LEFT JOIN store_inventory si ON sm.store_id = si.store_id AND sm.product_id = si.product_id
        WHERE ${whereConditions.join(' AND ')}
      `;

            // Execute query
            const result = await db.query(queryBase, params);

            // Process results based on grouping
            let groupedData = {};

            switch (groupBy) {
                case 'date':
                    // Group by date (daily)
                    result.rows.forEach(row => {
                        const date = new Date(row.created_at).toISOString().split('T')[0];

                        if (!groupedData[date]) {
                            groupedData[date] = {
                                date,
                                total_movements: 0,
                                stock_in: 0,
                                stock_in_value: 0,
                                sales: 0,
                                sales_value: 0,
                                removals: 0,
                                removals_value: 0,
                                transfers: 0,
                                transfers_value: 0
                            };
                        }

                        const price = row.price || row.base_price;
                        const value = price * row.quantity;

                        groupedData[date].total_movements++;

                        switch (row.type) {
                            case 'STOCK_IN':
                                groupedData[date].stock_in += row.quantity;
                                groupedData[date].stock_in_value += value;
                                break;
                            case 'SALE':
                                groupedData[date].sales += row.quantity;
                                groupedData[date].sales_value += value;
                                break;
                            case 'REMOVAL':
                                groupedData[date].removals += row.quantity;
                                groupedData[date].removals_value += value;
                                break;
                            case 'TRANSFER':
                                groupedData[date].transfers += row.quantity;
                                groupedData[date].transfers_value += value;
                                break;
                        }
                    });
                    break;

                case 'store':
                    // Group by store
                    result.rows.forEach(row => {
                        const storeId = row.store_id;

                        if (!groupedData[storeId]) {
                            groupedData[storeId] = {
                                store_id: storeId,
                                store_name: row.store_name,
                                total_movements: 0,
                                stock_in: 0,
                                stock_in_value: 0,
                                sales: 0,
                                sales_value: 0,
                                removals: 0,
                                removals_value: 0,
                                transfers: 0,
                                transfers_value: 0
                            };
                        }

                        const price = row.price || row.base_price;
                        const value = price * row.quantity;

                        groupedData[storeId].total_movements++;

                        switch (row.type) {
                            case 'STOCK_IN':
                                groupedData[storeId].stock_in += row.quantity;
                                groupedData[storeId].stock_in_value += value;
                                break;
                            case 'SALE':
                                groupedData[storeId].sales += row.quantity;
                                groupedData[storeId].sales_value += value;
                                break;
                            case 'REMOVAL':
                                groupedData[storeId].removals += row.quantity;
                                groupedData[storeId].removals_value += value;
                                break;
                            case 'TRANSFER':
                                groupedData[storeId].transfers += row.quantity;
                                groupedData[storeId].transfers_value += value;
                                break;
                        }
                    });
                    break;

                case 'product':
                    // Group by product
                    result.rows.forEach(row => {
                        const productId = row.product_id;

                        if (!groupedData[productId]) {
                            groupedData[productId] = {
                                product_id: productId,
                                product_name: row.product_name,
                                sku: row.sku,
                                total_movements: 0,
                                stock_in: 0,
                                stock_in_value: 0,
                                sales: 0,
                                sales_value: 0,
                                removals: 0,
                                removals_value: 0,
                                transfers: 0,
                                transfers_value: 0
                            };
                        }

                        const price = row.price || row.base_price;
                        const value = price * row.quantity;

                        groupedData[productId].total_movements++;

                        switch (row.type) {
                            case 'STOCK_IN':
                                groupedData[productId].stock_in += row.quantity;
                                groupedData[productId].stock_in_value += value;
                                break;
                            case 'SALE':
                                groupedData[productId].sales += row.quantity;
                                groupedData[productId].sales_value += value;
                                break;
                            case 'REMOVAL':
                                groupedData[productId].removals += row.quantity;
                                groupedData[productId].removals_value += value;
                                break;
                            case 'TRANSFER':
                                groupedData[productId].transfers += row.quantity;
                                groupedData[productId].transfers_value += value;
                                break;
                        }
                    });
                    break;

                case 'type':
                    // Group by movement type
                    result.rows.forEach(row => {
                        if (!groupedData[row.type]) {
                            groupedData[row.type] = {
                                type: row.type,
                                total_movements: 0,
                                total_quantity: 0,
                                total_value: 0
                            };
                        }

                        const price = row.price || row.base_price;
                        const value = price * row.quantity;

                        groupedData[row.type].total_movements++;
                        groupedData[row.type].total_quantity += row.quantity;
                        groupedData[row.type].total_value += value;
                    });
                    break;
            }

            // Format values
            Object.values(groupedData).forEach(group => {
                if (group.stock_in_value) group.stock_in_value = parseFloat(group.stock_in_value.toFixed(2));
                if (group.sales_value) group.sales_value = parseFloat(group.sales_value.toFixed(2));
                if (group.removals_value) group.removals_value = parseFloat(group.removals_value.toFixed(2));
                if (group.transfers_value) group.transfers_value = parseFloat(group.transfers_value.toFixed(2));
                if (group.total_value) group.total_value = parseFloat(group.total_value.toFixed(2));
            });

            // Calculate totals
            const totals = {
                total_movements: result.rows.length,
                stock_in: 0,
                stock_in_value: 0,
                sales: 0,
                sales_value: 0,
                removals: 0,
                removals_value: 0,
                transfers: 0,
                transfers_value: 0
            };

            result.rows.forEach(row => {
                const price = row.price || row.base_price;
                const value = price * row.quantity;

                switch (row.type) {
                    case 'STOCK_IN':
                        totals.stock_in += row.quantity;
                        totals.stock_in_value += value;
                        break;
                    case 'SALE':
                        totals.sales += row.quantity;
                        totals.sales_value += value;
                        break;
                    case 'REMOVAL':
                        totals.removals += row.quantity;
                        totals.removals_value += value;
                        break;
                    case 'TRANSFER':
                        totals.transfers += row.quantity;
                        totals.transfers_value += value;
                        break;
                }
            });

            // Format totals
            totals.stock_in_value = parseFloat(totals.stock_in_value.toFixed(2));
            totals.sales_value = parseFloat(totals.sales_value.toFixed(2));
            totals.removals_value = parseFloat(totals.removals_value.toFixed(2));
            totals.transfers_value = parseFloat(totals.transfers_value.toFixed(2));

            res.json({
                report_period: {
                    start_date: startDate,
                    end_date: endDate
                },
                summary: totals,
                data: Object.values(groupedData)
            });
        } catch (error) {
            next(error);
        }
    }
};