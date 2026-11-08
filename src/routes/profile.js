import { Router, raw } from 'express';
import { createAuthenticateFirebase } from '../middleware/authenticate-firebase.js';
import { createAvatarController } from '../controllers/avatarController.js';

export function createProfileRouter({ verifyToken, avatars }) {
  const router = Router();
  router.use(createAuthenticateFirebase(verifyToken));
  router.post('/avatar', raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }), createAvatarController(avatars).upload);
  return router;
}
