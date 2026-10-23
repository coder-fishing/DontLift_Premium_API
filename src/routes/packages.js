import { Router } from 'express';
import { listPackages } from '../controllers/systemController.js';

export function createPackageRouter() {
  const router = Router();
  router.get('/', listPackages);
  return router;
}
