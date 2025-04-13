import express from 'express';
import { AuthController } from '../controllers/AuthController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();
router.post('/login', AuthController.login);
router.post('/register', authenticate, authorize(['admin']), AuthController.register);
router.post('/refresh-token', AuthController.refreshToken);
router.put('/change-password', authenticate, AuthController.changePassword);
router.post('/logout', authenticate, AuthController.logout);

export const authRoutes = router;