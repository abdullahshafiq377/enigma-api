import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import userRoutes from './user.routes';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.json({
    success: true,
    status: 'ok',
    uptime: process.uptime(),
    database: dbState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

router.use('/users', userRoutes);

export default router;
