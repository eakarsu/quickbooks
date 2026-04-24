// Role-based access control middleware
const PERMISSIONS = {
  admin: ['read', 'write', 'delete', 'manage_users', 'manage_settings', 'export', 'bulk_operations'],
  manager: ['read', 'write', 'delete', 'export', 'bulk_operations'],
  user: ['read', 'write', 'export'],
  viewer: ['read'],
};

function authorize(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role || 'viewer';
    const userPermissions = PERMISSIONS[userRole] || [];

    const hasPermission = requiredPermissions.every(perm => userPermissions.includes(perm));

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: requiredPermissions,
        yourRole: userRole,
      });
    }

    next();
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient role',
        required: roles,
        yourRole: req.user.role,
      });
    }
    next();
  };
}

module.exports = { authorize, requireRole, PERMISSIONS };
