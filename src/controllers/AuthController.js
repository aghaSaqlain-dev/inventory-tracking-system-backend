import { db } from '../config/database.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret';
const JWT_EXPIRES_IN = '1h';
const JWT_REFRESH_EXPIRES_IN = '7d';


const tokenBlacklist = new Set(); //cache

export const AuthController = {
    /**
     * User login
     */
    async login(req, res, next) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            // Find user by email
            const user = await db.query(
                'SELECT * FROM users WHERE email = $1',
                [email]
            );

            if (user.rows.length === 0) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            const userData = user.rows[0];

            // Compare password
            const isPasswordValid = await bcrypt.compare(password, userData.password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            // Generate JWT tokens
            const accessToken = generateAccessToken(userData);
            const refreshToken = generateRefreshToken(userData);

            // Update user's refresh token in database
            await db.query(
                'UPDATE users SET refresh_token = $1 WHERE id = $2',
                [refreshToken, userData.id]
            );

            // Remove password from response
            delete userData.password;
            delete userData.refresh_token;

            res.json({
                message: 'Login successful',
                user: userData,
                accessToken,
                refreshToken
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * User registration (admin only)
     */
    async register(req, res, next) {
        try {
            const { name, email, password, role } = req.body;

            // Validate input
            if (!name || !email || !password) {
                return res.status(400).json({ error: 'Name, email and password are required' });
            }

            // Check if requester is admin (role-based authorization)
            if (req.user.role !== 'admin' && role !== 'user') {
                return res.status(403).json({ error: 'Only admins can create staff accounts' });
            }

            // Check if user already exists
            const existingUser = await db.query(
                'SELECT * FROM users WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({ error: 'User with this email already exists' });
            }

            // Hash the password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create new user
            const result = await db.query(
                `INSERT INTO users (name, email, password, role, created_at) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
         RETURNING id, name, email, role, created_at`,
                [name, email, hashedPassword, role || 'user']
            );

            res.status(201).json({
                message: 'User registered successfully',
                user: result.rows[0]
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Refresh access token
     */
    async refreshToken(req, res, next) {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ error: 'Refresh token is required' });
            }

            // Check if token is blacklisted
            if (tokenBlacklist.has(refreshToken)) {
                return res.status(401).json({ error: 'Invalid refresh token' });
            }

            // Verify refresh token
            let userData;
            try {
                userData = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
            } catch (error) {
                return res.status(401).json({ error: 'Invalid refresh token' });
            }

            // Check if user exists and token matches
            const user = await db.query(
                'SELECT * FROM users WHERE id = $1 AND refresh_token = $2',
                [userData.userId, refreshToken]
            );

            if (user.rows.length === 0) {
                return res.status(401).json({ error: 'Invalid refresh token' });
            }

            const userInfo = user.rows[0];

            // Generate new access token
            const accessToken = generateAccessToken(userInfo);

            res.json({
                message: 'Token refreshed successfully',
                accessToken
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Change password
     */
    async changePassword(req, res, next) {
        try {
            const userId = req.user.userId;
            const { currentPassword, newPassword } = req.body;

            if (!currentPassword || !newPassword) {
                return res.status(400).json({ error: 'Current password and new password are required' });
            }

            // Check if passwords are different
            if (currentPassword === newPassword) {
                return res.status(400).json({ error: 'New password must be different from current password' });
            }

            // Find user
            const user = await db.query(
                'SELECT * FROM users WHERE id = $1',
                [userId]
            );

            if (user.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }

            const userData = user.rows[0];

            // Verify current password
            const isPasswordValid = await bcrypt.compare(currentPassword, userData.password);
            if (!isPasswordValid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            // Hash new password
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Update password
            await db.query(
                'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [hashedPassword, userId]
            );

            res.json({
                message: 'Password changed successfully'
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Logout user
     */
    async logout(req, res, next) {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                return res.status(400).json({ error: 'Refresh token is required' });
            }

            // Add refresh token to blacklist
            tokenBlacklist.add(refreshToken);

            // Clear refresh token in database
            await db.query(
                'UPDATE users SET refresh_token = NULL WHERE id = $1',
                [req.user.userId]
            );

            res.json({
                message: 'Logged out successfully'
            });
        } catch (error) {
            next(error);
        }
    }
};

/**
 * Generate JWT access token
 */
// In the login method
function generateAccessToken(user) {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            role: user.role,
            storeId: user.store_id  // Include the store_id in the token
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

/**
 * Generate JWT refresh token
 */
function generateRefreshToken(user) {
    return jwt.sign(
        { userId: user.id },
        JWT_REFRESH_SECRET,
        { expiresIn: JWT_REFRESH_EXPIRES_IN }
    );
}