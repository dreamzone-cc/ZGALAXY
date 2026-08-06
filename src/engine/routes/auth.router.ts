import { Router } from 'express';
import { UserService } from '../../services/userService';
import { requireRole } from '../rbac';

export const authRouter = Router();

// Login Gateway
authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const session = await UserService.authenticate(username, password);
    res.json({ success: true, data: session });
  } catch (err: any) {
    res.status(401).json({ success: false, error: err.message });
  }
});

// Current User Profile
authRouter.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, error: 'Unauthenticated' });

    const token = authHeader.substring(7);
    const session = await UserService.validateToken(token);
    if (!session) return res.status(401).json({ success: false, error: 'Invalid or expired session' });

    res.json({ success: true, data: session });
  } catch (err) {
    next(err);
  }
});

// Members Management List (Admin only)
authRouter.get('/users', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const users = await UserService.getUsers();
    // Exclude password hashes & salts
    const safeUsers = users.map(({ username, role, createdAt, lastLoginAt }) => ({
      username,
      role,
      createdAt,
      lastLoginAt,
    }));
    res.json({ success: true, data: safeUsers });
  } catch (err) {
    next(err);
  }
});

// Create New Member (Admin only)
authRouter.post('/users/create', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
      return res.status(400).json({ success: false, error: 'Username, password, and role are required.' });
    }

    const user = await UserService.createUser(username, password, role);
    res.status(201).json({
      success: true,
      data: { username: user.username, role: user.role, createdAt: user.createdAt },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete Member (Admin only)
authRouter.delete('/users/:username', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { username } = req.params;
    await UserService.deleteUser(username);
    res.json({ success: true, message: `Member '${username}' deleted successfully.` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Logout - explicitly invalidate the current session token
authRouter.post('/logout', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
      await UserService.revokeSession(token);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});
