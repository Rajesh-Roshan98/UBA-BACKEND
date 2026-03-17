/**
 * Middleware to restrict access based on user roles.
 * @param  {...String} allowedRoles - A list of roles permitted to access the route (e.g., 'admin', 'user')
 */
const roleMiddleware = (...allowedRoles) => {
  return (req, res, next) => {
    // 1. Ensure the user object exists (this should be set prior by authMiddleware)
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User information is missing.",
      });
    }

    // 2. Check if the user's role is included in the allowed roles
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You do not have the required permissions to perform this action.",
      });
    }

    // 3. Role is authorized, proceed to the controller
    next();
  };
};

module.exports = roleMiddleware;