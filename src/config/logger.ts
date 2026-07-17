import { pino } from 'pino';

import { env } from '@/config/env';

/**
 * Structured JSON logger (pino). In development we pretty-print; in
 * production we emit raw JSON for log aggregators. Tests stay silent.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  ...(env.isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
