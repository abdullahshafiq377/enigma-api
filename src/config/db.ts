import mongoose from 'mongoose';

import { env } from '@/config/env';
import { logger } from '@/config/logger';

/** Connect to MongoDB. Reuses a single Mongoose connection across the app. */
export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(env.MONGODB_URL, {
    serverSelectionTimeoutMS: 10_000,
  });
}

/** Close the MongoDB connection. `force=false` lets pending ops finish. */
export async function disconnectDatabase(force = false): Promise<void> {
  await mongoose.connection.close(force);
  logger.info('MongoDB connection closed');
}
