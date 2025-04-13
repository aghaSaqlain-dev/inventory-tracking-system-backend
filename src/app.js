import express from 'express';
import { stockMovementRoutes } from './routes/stockMovementRoutes.js';
import { productRoutes } from './routes/productRoutes.js';
import { storeRoutes } from './routes/storeRoutes.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// APIs
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stores', storeRoutes);

app.use((error, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Error: ${error.message}`);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
});

app.get('/', (req, res) => {
    res.send('Welcome to the Inventory Tracking System API!');
});

const dbPath = path.join(__dirname, '../../database.sqlite');

app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}\nDatabase: ${dbPath}`));