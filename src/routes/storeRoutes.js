import express from 'express';
import { StoreController } from '../controllers/storeController.js';

const router = express.Router();

router.get('/', StoreController.getAllStores);
router.get('/:id', StoreController.getStoreById);
router.post('/', StoreController.createStore);
router.put('/:id', StoreController.updateStore);

export const storeRoutes = router;