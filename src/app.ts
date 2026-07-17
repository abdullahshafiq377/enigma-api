import { clerkMiddleware } from '@clerk/express';
import compression from 'compression';
import cors from 'cors';
import express, { type Application, type Request, type Response } from 'express';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { errorHandler } from '@/middlewares/errorHandler';
import { mongoSanitize } from '@/middlewares/mongoSanitize';
import { notFound } from '@/middlewares/notFound';
import { apiRateLimiter } from '@/middlewares/rateLimit';
import v1Router from '@/routes';

/**
 * Builds and returns the Express app (no `.listen()` — `server.ts` owns that),
 * which keeps the app directly testable with supertest.
 *
 * Middleware order: security → body parsing → request logging → rate limiting
 * → sanitize → routes → 404 → centralized error handler (last).
 */
export function createApp(): Application {
  const app = express();

  // Behind a proxy/CDN/tunnel (cloudflared, CloudFront, ALB), trust the
  // forwarded headers so rate-limiting + client IP work correctly.
  app.set('trust proxy', 1);

  // Security & performance
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(compression());

  // Webhooks need the RAW body for signature verification — must run before json().
  app.use('/v1/webhooks', express.raw({ type: 'application/json' }));

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (structured, with request-id)
  app.use(pinoHttp({ logger }));

  // Rate limiting + NoSQL-injection guard
  app.use(apiRateLimiter);
  app.use(mongoSanitize);

  // Clerk auth context (attaches session for requireAuth). Mounted only when
  // BOTH keys are configured and outside tests — clerkMiddleware rejects every
  // request if the publishable key is missing/invalid.
  if (!env.isTest && env.CLERK_SECRET_KEY && env.CLERK_PUBLISHABLE_KEY) {
    app.use(clerkMiddleware());
  }

  // Health check (top-level, for load balancers / Docker HEALTHCHECK)
  app.get('/health', (_req: Request, res: Response) => {
    const dbConnected = mongoose.connection.readyState === 1;
    res.json({
      data: {
        status: 'ok',
        uptime: process.uptime(),
        database: dbConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
      },
      error: null,
    });
  });

  // Versioned API
  app.use('/v1', v1Router);

  // 404 + centralized error handler (must be last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
