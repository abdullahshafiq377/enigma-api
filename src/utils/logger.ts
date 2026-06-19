/* Minimal leveled logger. Swap for pino/winston later if needed. */

type LogArgs = unknown[];

function timestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  info(message: string, ...args: LogArgs): void {
    console.log(`[${timestamp()}] [INFO] ${message}`, ...args);
  },
  warn(message: string, ...args: LogArgs): void {
    console.warn(`[${timestamp()}] [WARN] ${message}`, ...args);
  },
  error(message: string, ...args: LogArgs): void {
    console.error(`[${timestamp()}] [ERROR] ${message}`, ...args);
  },
  debug(message: string, ...args: LogArgs): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[${timestamp()}] [DEBUG] ${message}`, ...args);
    }
  },
};
