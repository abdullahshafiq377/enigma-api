import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json({ success: true, data: users });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  res.json({ success: true, data: user });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { name, email } = req.body;
  if (!name || !email) {
    throw ApiError.badRequest('Both "name" and "email" are required');
  }
  const user = await User.create({ name, email });
  res.status(201).json({ success: true, data: user });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  res.status(204).send();
});
