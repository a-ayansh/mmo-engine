import { createClient } from 'redis';

class RedisClient {
  constructor() {
    this.client = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379
      },
      password: process.env.REDIS_PASSWORD || undefined,
      database: parseInt(process.env.REDIS_DB) || 0
    });

    this.isConnected = false;

    this.client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('✅ Connected to Redis');
    });
  }

  async init() {
    if (!this.isConnected) {
      try {
        await this.client.connect();
        this.isConnected = true;
      } catch (err) {
        console.error('❌ Failed to connect to Redis:', err);
        throw err;
      }
    }
  }

  async disconnect() {
    if (this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  // Utility methods...
  async get(key) {
    return this.client.get(key);
  }

  async set(key, value) {
    return this.client.set(key, value);
  }

  async setEx(key, seconds, value) {
    return this.client.setEx(key, seconds, value);
  }

  async del(key) {
    return this.client.del(key);
  }

  async exists(key) {
    return this.client.exists(key);
  }

  async expire(key, seconds) {
    return this.client.expire(key, seconds);
  }

  async zAdd(key, entries) {
    return this.client.zAdd(key, entries);
  }

  async zRem(key, member) {
    return this.client.zRem(key, member);
  }

  async zRange(key, start, stop) {
    return this.client.zRange(key, start, stop);
  }

  async zRevRange(key, start, stop, withScores = false) {
    return withScores
      ? this.client.zRevRangeWithScores(key, start, stop)
      : this.client.zRevRange(key, start, stop);
  }

  async zCard(key) {
    return this.client.zCard(key);
  }

  async zRemRangeByScore(key, min, max) {
    return this.client.zRemRangeByScore(key, min, max);
  }

  async incr(key) {
    return this.client.incr(key);
  }

  async decr(key) {
    return this.client.decr(key);
  }

  async ping() {
    return this.client.ping();
  }
}

const redisClient = new RedisClient();

export default redisClient;
