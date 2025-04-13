import express from 'express';
import { StockMovementController } from '../controllers/StockMovementController.js';

const router = express.Router();

router.post('/', StockMovementController.createMovement);
router.get('/product/:productId', StockMovementController.getProductMovements);

export const stockMovementRoutes = router;