import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Validate environment variables at boot with Zod and export a typed, frozen
 * config. Fail fast if anything is missing or malformed.
 *
 * Clerk and AWS vars are optional in this phase (their modules are not yet
 * mounted); make them required once their features are wired.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Comma-separated list of allowed CORS origins (frontend URLs).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5001')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

  MONGODB_URL: z.string().min(1, 'MONGODB_URL is required'),

  // Public base URL of the frontend — used as the invitation accept/redirect target.
  APP_BASE_URL: z.string().url().default('http://localhost:5001'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // --- Optional until their features are wired (Clerk auth, AWS video) ---
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_INPUT_BUCKET: z.string().optional(),
  AWS_S3_OUTPUT_BUCKET: z.string().optional(),
  CLOUDFRONT_DOMAIN: z.string().optional(),
  CLOUDFRONT_KEY_PAIR_ID: z.string().optional(),
  // Parent domain for signed cookies (e.g. ".enigma.edu") so cdn.* receives them.
  COOKIE_DOMAIN: z.string().optional(),
  // RSA private key PEM for CloudFront signed cookies (supports literal "\n").
  CLOUDFRONT_PRIVATE_KEY: z.string().optional(),
  MEDIACONVERT_ROLE_ARN: z.string().optional(),
  MEDIACONVERT_QUEUE_ARN: z.string().optional(),
  TRANSCRIBE_LANGUAGE: z.string().default('en-US'),

  // --- Transactional email (AWS SES) ---
  // Verified SES sender, e.g. "invites@krewclub.co". When unset, invite emails are
  // skipped (no-op) — invitations are still created with their link.
  EMAIL_FROM: z.string().email().optional(),
  EMAIL_REPLY_TO: z.string().email().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed. See errors above.');
}

const data = parsed.data;

export const env = Object.freeze({
  ...data,
  isProduction: data.NODE_ENV === 'production',
  isTest: data.NODE_ENV === 'test',
  isDevelopment: data.NODE_ENV === 'development',
});

export type Env = typeof env;
