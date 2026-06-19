import { Router } from 'express';
import {
  listUsers,
  getUser,
  createUser,
  deleteUser,
} from '../controllers/user.controller';

const router = Router();

router.get('/', listUsers);
router.post('/', createUser);
router.get('/:id', getUser);
router.delete('/:id', deleteUser);

export default router;
