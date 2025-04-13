import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Rate limiter
export const limiter = rateLimit({
    windowMs: 60 * 1000, // a minute
    max: 500, // 500 requests per window
    message: { error: 'Too many requests, please try again later.' }
});

// Auth middleware
export const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// Role-based authorization
export const authorize = (roles = []) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (roles.length && !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
};

// Store-aware authorization middleware
export const enforceStoreAccess = () => {
    return (req, res, next) => {
        // Skip for admins who can access any store
        if (req.user && req.user.role === 'admin') {
            return next();
        }

        // Get requested store ID (from route params or query)
        const requestedStoreId = parseInt(req.params.storeId || req.params.id || req.query.storeId);

        // If no specific store is requested, continue
        if (!requestedStoreId) {
            return next();
        }

        // Check if user has access to requested store
        if (!req.user || req.user.storeId !== requestedStoreId) {
            return res.status(403).json({
                error: 'Access denied',
                message: 'You do not have permission to access data for this store'
            });
        }

        next();
    };
};