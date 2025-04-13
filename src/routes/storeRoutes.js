import express from 'express';
import { StoreController } from '../controllers/storeController.js';
import { authenticate, authorize, enforceStoreAccess } from '../middleware/auth.js';

const router = express.Router();

// All stores listing - available to all authenticated users
// (Admin sees all, store users will see filtered results in controller)
router.get('/', StoreController.getAllStores);

// Single store operations - enforce store access
router.get('/:id', enforceStoreAccess(), StoreController.getStoreById);
router.put('/:id', authorize(['admin', 'manager']), enforceStoreAccess(), StoreController.updateStore);
router.delete('/:id', authorize(['admin']), StoreController.deleteStore);
router.get('/:id/metrics', enforceStoreAccess(), StoreController.getStoreMetrics);

// Store creation - typically admin only
router.post('/', authorize(['admin']), StoreController.createStore);

export const storeRoutes = router;