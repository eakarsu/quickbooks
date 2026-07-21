// Global error handler middleware
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Build error response
  const response = { error: statusCode >= 500 ? 'Internal Server Error' : (err.message || 'Request failed'), code: err.code || 'REQUEST_ERROR' };

  res.status(statusCode).json(response);
}

// 404 handler
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

module.exports = { errorHandler, notFoundHandler };
