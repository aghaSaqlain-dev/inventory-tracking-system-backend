import express from 'express';
import { ProductCatalogController } from '../controllers/ProductCatalogController.js';
import { authorize } from '../middleware/auth.js';

const router = express.Router();

// Read operations - available to all authenticated users
// (authenticate middleware is already applied in app.js)
router.get('/', ProductCatalogController.getAllProducts);
router.get('/:id', ProductCatalogController.getProductById);
router.get('/category/:category', ProductCatalogController.getProductsByCategory);
router.get('/search/:query', ProductCatalogController.searchProducts);

// Write operations - restricted to admin and manager roles
router.post('/', authorize(['admin', 'manager']), ProductCatalogController.createProduct);
router.put('/:id', authorize(['admin', 'manager']), ProductCatalogController.updateProduct);
router.delete('/:id', authorize(['admin']), ProductCatalogController.deleteProduct);

export const productCatalogRoutes = router;