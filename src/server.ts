import { createApp } from '@/app';
import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Enigma API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return; // guard against double signals
    shuttingDown = true;
    logger.warn(`Received ${signal}, shutting down gracefully...`);

    // Force-exit if graceful drain stalls (keep-alive sockets can hang server.close).
    const forceTimer = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    forceTimer.unref();

    try {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await disconnectDatabase(false);
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
