/* Minimal in-memory sliding-window limiter for the public lead-intake endpoint.
 * Good enough for a single-process Phase 1; swap for Redis when this platform
 * runs more than one instance. */
const hits = new Map();

export const rateLimit = (max, windowMs) => (req, res, next) => {
  const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  hits.set(key, entry);
  if (entry.count > max) {
    return res.status(429).json({ error: "too many requests, try again shortly" });
  }
  next();
};
