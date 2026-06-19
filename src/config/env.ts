import dotenv from 'dotenv';

dotenv.config();

interface Env {
  nodeEnv: string;
  port: number;
  mongodbUrl: string;
  isProduction: boolean;
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';

export const env: Env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  mongodbUrl: required('MONGODB_URL'),
  isProduction: nodeEnv === 'production',
};
