import { rateLimit } from 'express-rate-limit';

import { env } from '@/config/env';

/** Global API rate limiter. Returns 429 + standard RateLimit-* headers when exceeded. */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300, // per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Effectively disabled during tests to avoid flakiness.
  skip: () => env.isTest,
  message: { data: null, error: { message: 'Too many requests, please try again later.' } },
});
