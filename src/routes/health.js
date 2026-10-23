import { Router } from 'express';
import { health } from '../controllers/systemController.js';

export function createHealthRouter() {
  const router = Router();
  router.get('/', health);
  return router;
}
