import { Router, raw } from 'express';
import { createAuthenticateFirebase } from '../middleware/authenticate-firebase.js';
import { ApiError } from '../domain/apiError.js';

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function createReceiptScanRouter({ verifyToken, receiptScans }) {
  const router = Router();
  router.use(createAuthenticateFirebase(verifyToken));
  router.post('/scan', raw({ type: [...supportedTypes], limit: '10mb' }), async (req, res) => {
    const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!supportedTypes.has(contentType) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new ApiError('invalid-image', 415);
    }
    if (typeof req.query.roomId !== 'string') throw new ApiError('invalid-argument', 400);
    const result = await receiptScans.scan({ uid: res.locals.uid, roomId: req.query.roomId,
      buffer: req.body, contentType });
    res.status(200).json({ version: 1, ...result });
  });
  return router;
}
