import RedisClient from '../config/redis.js';

class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  async isAllowed(identifier) {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old entries
    await RedisClient.zRemRangeByScore(key, 0, windowStart);

    // Count current requests
    const requestCount = await RedisClient.zCard(key);
    if (requestCount >= this.maxRequests) {
      return false;
    }

    // Add current request
    await RedisClient.zAdd(key, [{ score: now, value: String(now) }]);

    // Set expiration
    await RedisClient.expire(key, Math.ceil(this.windowMs / 1000));

    return true;
  }

  middleware() {
    return async (req, res, next) => {
      const identifier = req.ip || req.connection?.remoteAddress;

      try {
        const allowed = await this.isAllowed(identifier);
        if (allowed) {
          next();
        } else {
          res.status(429).json({ error: 'Rate limit exceeded' });
        }
      } catch (err) {
        console.error('❌ RateLimiter error:', err);
        res.status(500).json({ error: 'Rate limiter failed' });
      }
    };
  }
}

export default RateLimiter;
  