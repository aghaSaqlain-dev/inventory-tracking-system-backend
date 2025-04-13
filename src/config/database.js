import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    user: 'postgres',
    host: process.env.DB_HOST || 'db_pass',
    database: 'inventory_tracking_system',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_port || 5432,
    max: 20 // <- Connection pool size
});

// init queries
const setupQueries = `
CREATE TABLE IF NOT EXISTS store (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    phone VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_catalog (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    sku VARCHAR(50) UNIQUE,
    description TEXT,
    base_price DECIMAL(10,2) NOT NULL,
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_inventory (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    price DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES store(id),
    FOREIGN KEY (product_id) REFERENCES product_catalog(id),
    UNIQUE(store_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movement (
    id SERIAL PRIMARY KEY,
    store_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('STOCK_IN', 'SALE', 'REMOVAL', 'TRANSFER')),
    reference_id VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (store_id) REFERENCES store(id),
    FOREIGN KEY (product_id) REFERENCES product_catalog(id)
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    store_id INTEGER REFERENCES store(id),
    refresh_token TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_store_product ON stock_movement(store_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_date ON stock_movement(created_at);
CREATE INDEX IF NOT EXISTS idx_store_inventory_product ON store_inventory(product_id);
CREATE INDEX IF NOT EXISTS idx_store_inventory_store ON store_inventory(store_id);
`;

export const db = {
    query: (text, params) => pool.query(text, params)
};

// Init dbs
const initDb = async () => {
    try {
        await pool.query(setupQueries);
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
    }
};

initDb();