/* In-memory request/error counters for a single-process deployment — good
 * enough to answer "is this thing healthy?" without adding a metrics
 * backend (Prometheus/Datadog) this platform doesn't run yet. */
const startedAt = Date.now();
let totalRequests = 0;
let totalErrors = 0;
const recentErrors = [];
const MAX_RECENT_ERRORS = 20;

export const metricsMiddleware = (req, res, next) => {
  totalRequests++;
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      totalErrors++;
      recentErrors.unshift({ method: req.method, path: req.originalUrl, status: res.statusCode, at: new Date().toISOString() });
      if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.length = MAX_RECENT_ERRORS;
    }
  });
  next();
};

export const getRequestMetrics = () => ({
  uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  totalRequests,
  totalErrors,
  recentErrors: recentErrors.slice(0, MAX_RECENT_ERRORS),
});
