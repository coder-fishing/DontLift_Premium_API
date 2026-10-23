import { Router } from 'express';
import { root } from '../controllers/systemController.js';

export function createRootRouter() {
  const router = Router();
  router.get('/', root);
  return router;
}
