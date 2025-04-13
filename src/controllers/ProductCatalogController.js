import { db } from '../config/database.js';

export const ProductCatalogController = {
    /**
     * Get all products with pagination and filtering
     */
    async getAllProducts(req, res, next) {
        try {
            const {
                page = 1,
                limit = 20,
                sortBy = 'name',
                sortOrder = 'ASC',
                minPrice,
                maxPrice,
                category
            } = req.query;

            const offset = (page - 1) * limit;
            let params = [];
            let whereConditions = [];
            let queryCount = 'SELECT COUNT(*) FROM product_catalog';
            let query = 'SELECT * FROM product_catalog';

            // Build WHERE conditions
            if (minPrice) {
                params.push(parseFloat(minPrice));
                whereConditions.push(`base_price >= $${params.length}`);
            }

            if (maxPrice) {
                params.push(parseFloat(maxPrice));
                whereConditions.push(`base_price <= $${params.length}`);
            }

            if (category) {
                params.push(category);
                whereConditions.push(`category = $${params.length}`);
            }

            // Add WHERE clause if conditions exist
            if (whereConditions.length > 0) {
                query += ' WHERE ' + whereConditions.join(' AND ');
                queryCount += ' WHERE ' + whereConditions.join(' AND ');
            }

            // Validate sort parameters to prevent SQL injection
            const allowedSortColumns = ['name', 'base_price', 'sku', 'created_at'];
            const allowedSortOrders = ['ASC', 'DESC'];

            const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'name';
            const validSortOrder = allowedSortOrders.includes(sortOrder.toUpperCase())
                ? sortOrder.toUpperCase()
                : 'ASC';

            // Add sorting
            query += ` ORDER BY ${validSortBy} ${validSortOrder}`;

            // Add pagination
            query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(parseInt(limit), parseInt(offset));

            // Execute queries
            const countResult = await db.query(queryCount, params.slice(0, params.length - 2));
            const result = await db.query(query, params);

            // Calculate total pages
            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                products: result.rows,
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
     * Get a single product by ID
     */
    async getProductById(req, res, next) {
        try {
            const { id } = req.params;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid product ID is required' });
            }

            const result = await db.query(
                'SELECT * FROM product_catalog WHERE id = $1',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Fetch inventory data across all stores
            const inventoryResult = await db.query(
                `SELECT si.store_id, s.name as store_name, si.quantity, si.price
         FROM store_inventory si 
         JOIN store s ON si.store_id = s.id
         WHERE si.product_id = $1`,
                [id]
            );

            // Return product with its inventory data
            res.json({
                ...result.rows[0],
                inventory: inventoryResult.rows
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Create a new product
     */
    async createProduct(req, res, next) {
        try {
            const { name, sku, description, basePrice, category } = req.body;

            // Validate required fields
            if (!name || !basePrice) {
                return res.status(400).json({ error: 'Name and base price are required' });
            }

            // Check if SKU already exists
            if (sku) {
                const existingProduct = await db.query(
                    'SELECT id FROM product_catalog WHERE sku = $1',
                    [sku]
                );

                if (existingProduct.rows.length > 0) {
                    return res.status(409).json({ error: 'A product with this SKU already exists' });
                }
            }

            // Insert new product
            const result = await db.query(
                `INSERT INTO product_catalog (name, sku, description, base_price, category)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
                [name, sku, description, basePrice, category]
            );

            res.status(201).json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Update an existing product
     */
    async updateProduct(req, res, next) {
        try {
            const { id } = req.params;
            const { name, sku, description, basePrice, category } = req.body;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid product ID is required' });
            }

            // Check if product exists
            const existingProduct = await db.query(
                'SELECT * FROM product_catalog WHERE id = $1',
                [id]
            );

            if (existingProduct.rows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const currentProduct = existingProduct.rows[0];

            // Check if new SKU (if provided) already exists on a different product
            if (sku && sku !== currentProduct.sku) {
                const skuCheck = await db.query(
                    'SELECT id FROM product_catalog WHERE sku = $1 AND id != $2',
                    [sku, id]
                );

                if (skuCheck.rows.length > 0) {
                    return res.status(409).json({ error: 'Another product with this SKU already exists' });
                }
            }

            // Update product
            const result = await db.query(
                `UPDATE product_catalog 
         SET 
           name = $1, 
           sku = $2, 
           description = $3, 
           base_price = $4,
           category = $5,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $6
         RETURNING *`,
                [
                    name || currentProduct.name,
                    sku || currentProduct.sku,
                    description !== undefined ? description : currentProduct.description,
                    basePrice || currentProduct.base_price,
                    category !== undefined ? category : currentProduct.category,
                    id
                ]
            );

            res.json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    },

    /**
     * Delete a product
     */
    async deleteProduct(req, res, next) {
        try {
            const { id } = req.params;

            if (!id || isNaN(parseInt(id))) {
                return res.status(400).json({ error: 'Valid product ID is required' });
            }

            // Check if product exists
            const existingProduct = await db.query(
                'SELECT id FROM product_catalog WHERE id = $1',
                [id]
            );

            if (existingProduct.rows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            // Check if product has inventory or movement records
            const inventoryCheck = await db.query(
                'SELECT id FROM store_inventory WHERE product_id = $1 LIMIT 1',
                [id]
            );

            if (inventoryCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Cannot delete product with existing inventory records',
                    message: 'Please remove all inventory records first'
                });
            }

            // Delete the product
            await db.query('DELETE FROM product_catalog WHERE id = $1', [id]);

            res.json({ message: 'Product deleted successfully' });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get products by category
     */
    async getProductsByCategory(req, res, next) {
        try {
            const { category } = req.params;
            const { page = 1, limit = 20 } = req.query;

            if (!category) {
                return res.status(400).json({ error: 'Category is required' });
            }

            const offset = (page - 1) * limit;

            // Get products count
            const countResult = await db.query(
                'SELECT COUNT(*) FROM product_catalog WHERE category = $1',
                [category]
            );

            // Get products with pagination
            const result = await db.query(
                `SELECT * FROM product_catalog 
         WHERE category = $1 
         ORDER BY name 
         LIMIT $2 OFFSET $3`,
                [category, limit, offset]
            );

            // Calculate total pages
            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                category,
                products: result.rows,
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
     * Search products
     */
    async searchProducts(req, res, next) {
        try {
            const { query } = req.params;
            const { page = 1, limit = 20 } = req.query;

            if (!query || query.trim() === '') {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const searchTerm = `%${query}%`;
            const offset = (page - 1) * limit;

            // Get matching products count
            const countResult = await db.query(
                `SELECT COUNT(*) FROM product_catalog 
         WHERE 
           name ILIKE $1 OR 
           sku ILIKE $1 OR 
           description ILIKE $1 OR
           category ILIKE $1`,
                [searchTerm]
            );

            // Get matching products with pagination
            const result = await db.query(
                `SELECT * FROM product_catalog 
         WHERE 
           name ILIKE $1 OR 
           sku ILIKE $1 OR 
           description ILIKE $1 OR
           category ILIKE $1
         ORDER BY name 
         LIMIT $2 OFFSET $3`,
                [searchTerm, limit, offset]
            );

            // Calculate total pages
            const total = parseInt(countResult.rows[0].count);
            const totalPages = Math.ceil(total / limit);

            res.json({
                query,
                products: result.rows,
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
    }
};