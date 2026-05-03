import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

// ============================================================================
// 1. REDIS INITIALIZATION
// ============================================================================
let redisClient;
const useRedis = process.env.USE_REDIS === 'true';

// 🔥 FIX 1 & 2: Async init function + Production Memory Store Warning
export const initRedisLimiter = async () => {
  if (process.env.NODE_ENV === 'production' && !useRedis) {
    console.warn('⚠️ WARNING: Using memory store for rate limiting in production. This will not work across PM2 clusters or Docker containers. Set USE_REDIS=true.');
  }

  if (useRedis) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    redisClient.on('error', (err) => console.error('Redis Limiter Error:', err));
    redisClient.on('connect', () => console.log('Redis Limiter Connected Successfully'));
    
    await redisClient.connect(); 
  }
};

// ============================================================================
// 2. DYNAMIC STORE GENERATOR
// ============================================================================
const getLimiterStore = (prefixName) => {
  if (useRedis && redisClient) {
    return new RedisStore({
      // @ts-expect-error - Known typing issue with express-rate-limit and redis v4
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: `uba_rate_limit:${prefixName}:`, 
    });
  }
  return undefined; // Fallback to basic memory store
};

// ============================================================================
// 3. KEY GENERATORS & HANDLERS
// ============================================================================

// Hybrid Generator: For standard authenticated routes
const hybridKeyGenerator = (req) => {
  return req.user?.id || req.user?._id || req.userId || req.ip;
};

// 🔥 FIX 3: Auth Key Generator (Prevents VPN bypass during login/signup)
const authKeyGenerator = (req) => {
  return req.body?.email?.toLowerCase() || req.ip;
};

// 🔥 FIX 4: Standardized Handler (Sends proper 429 status and retry-after payload)
const createRateLimitHandler = (message) => (req, res, next, options) => {
  res.status(options?.statusCode || 429).json({
    success: false,
    message: message,
    retryAfter: res.getHeader('Retry-After') || Math.ceil(options.windowMs / 1000)
  });
};

// ============================================================================
// 4. EXPORTED LIMITERS (🔥 FIX 1: Lazy-loaded to ensure Redis connects first)
// ============================================================================
// By wrapping these in standard middleware functions `(req, res, next)`, 
// they won't initialize `getLimiterStore` until the very first request comes in.
// This perfectly preserves your router syntax: `router.use(globalLimiter)`

let _globalLimiter;
export const globalLimiter = (req, res, next) => {
  if (!_globalLimiter) {
    _globalLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 150,
      standardHeaders: true, 
      legacyHeaders: false,
      validate: false, // 🔥 THE FIX: Suppress strict console warnings
      store: getLimiterStore('global'), 
      keyGenerator: hybridKeyGenerator,
      // 🔥 UPDATED: Skip health checks AND the high-frequency UBA log ingestion route
      skip: (req) => req.path === '/health' || req.originalUrl === '/api/v1/uba/log', 
      handler: createRateLimitHandler('Too many requests detected from this IP. Please try again later.')
    });
  }
  return _globalLimiter(req, res, next);
};

let _authLimiter;
export const authLimiter = (req, res, next) => {
  if (!_authLimiter) {
    _authLimiter = rateLimit({
      windowMs: 10 * 60 * 1000, // 10 minutes
      max: 8,
      standardHeaders: true,
      legacyHeaders: false,
      validate: false, // 🔥 THE FIX
      store: getLimiterStore('auth'), 
      keyGenerator: authKeyGenerator, // Auth specific tracking
      handler: createRateLimitHandler('Too many login attempts. Account locked for 10 minutes.')
    });
  }
  return _authLimiter(req, res, next);
};

let _otpLimiter;
export const otpLimiter = (req, res, next) => {
  if (!_otpLimiter) {
    _otpLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 4,
      standardHeaders: true,
      legacyHeaders: false,
      validate: false, // 🔥 THE FIX
      store: getLimiterStore('otp'),
      keyGenerator: authKeyGenerator, // Tracks by email to prevent bombing
      handler: createRateLimitHandler('Too many OTP requests. Please wait 15 minutes before trying again.')
    });
  }
  return _otpLimiter(req, res, next);
};

let _contactFormLimiter;
export const contactFormLimiter = (req, res, next) => {
  if (!_contactFormLimiter) {
    _contactFormLimiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 4,
      standardHeaders: true,
      legacyHeaders: false,
      validate: false, // 🔥 THE FIX
      store: getLimiterStore('contact'),
      keyGenerator: hybridKeyGenerator,
      handler: createRateLimitHandler('You can only submit the contact form twice per hour.')
    });
  }
  return _contactFormLimiter(req, res, next);
};

let _logIngestionLimiter;
export const logIngestionLimiter = (req, res, next) => {
  if (!_logIngestionLimiter) {
    _logIngestionLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 1000,
      standardHeaders: true,
      legacyHeaders: false,
      validate: false, // 🔥 THE FIX
      store: getLimiterStore('uba_logs'),
      keyGenerator: hybridKeyGenerator,
      handler: createRateLimitHandler('Log ingestion rate limit exceeded. Please throttle agent payloads.')
    });
  }
  return _logIngestionLimiter(req, res, next);
};
