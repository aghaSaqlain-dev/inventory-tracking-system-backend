import express from 'express';
import helmet from 'helmet';
import { productCatalogRoutes } from './routes/productCatalogRoutes.js';
import { inventoryRoutes } from './routes/inventoryRoutes.js';
import { storeRoutes } from './routes/storeRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { authenticate, limiter } from './middleware/auth.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(express.json());

// Rate limiter for all requests
app.use(limiter);

// Public routes
app.use('/api/auth', authRoutes);

// Protected routes
app.use('/api/catalog', authenticate, productCatalogRoutes);
app.use('/api/inventory', authenticate, inventoryRoutes);
app.use('/api/stores', authenticate, storeRoutes);


app.use((error, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Error: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
});

app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);