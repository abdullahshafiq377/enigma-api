import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import routes from './routes';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import { env } from './config/env';

const app: Application = express();

// Security & performance middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(morgan(env.isProduction ? 'combined' : 'dev'));

// Root
app.get('/', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Welcome to Enigma API' });
});

// API routes
app.use('/api', routes);

// 404 + error handling (must be last)
app.use(notFound);
app.use(errorHandler);

export default app;
