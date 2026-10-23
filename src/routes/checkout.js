import { Router } from 'express';
import { checkoutReturn } from '../controllers/systemController.js';

export function createCheckoutRouter() {
  const router = Router();
  router.get(['/return', '/cancel'], checkoutReturn);
  return router;
}
