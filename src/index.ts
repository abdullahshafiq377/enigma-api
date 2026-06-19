import app from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();

    const server = app.listen(env.port, () => {
      logger.info(`Enigma API listening on http://localhost:${env.port} (${env.nodeEnv})`);
    });

    const shutdown = async (signal: string): Promise<void> => {
      logger.warn(`Received ${signal}, shutting down gracefully...`);
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

void bootstrap();
