const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fde-platform-secret-key-2024';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Middleware: require authentication.
 * Returns { user } on success, or { error, status } on failure.
 */
function authRequired(request) {
  const header = request.headers['authorization'] || request.headers.get?.('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return { error: '请先登录', status: 401 };
  }
  try {
    const token = header.split(' ')[1];
    const user = verifyToken(token);
    return { user };
  } catch (err) {
    return { error: '登录已过期，请重新登录', status: 401 };
  }
}

/**
 * Middleware: optional auth (attach user if token present).
 */
function authOptional(request) {
  const header = request.headers['authorization'] || request.headers.get?.('authorization');
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.split(' ')[1];
      return { user: verifyToken(token) };
    } catch (err) {
      // Ignore invalid token for optional auth
    }
  }
  return {};
}

/**
 * Check if user has admin role.
 */
function adminRequired(user) {
  if (!user || user.role !== 'admin') {
    return { error: '需要管理员权限', status: 403 };
  }
  return {};
}

module.exports = { generateToken, verifyToken, authRequired, authOptional, adminRequired };
