import { ApiError } from '../domain/apiError.js';

const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxImageBytes = 10 * 1024 * 1024;
const roomIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
const statuses = new Set(['suggested', 'needs_review']);

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.isSafeInteger(value) ? value : null;
}

function validAmount(value) {
  return value === null || (Number.isSafeInteger(value) && value > 0 && value <= 999_999_999_999);
}

function checkedScanResult(value) {
  if (!value || typeof value !== 'object' || !statuses.has(value.status) || value.currency !== 'VND'
    || !validAmount(value.amount) || !validAmount(value.suggested_amount)
    || value.needs_confirmation !== true
    || !(value.evidence === null || (typeof value.evidence === 'object' && !Array.isArray(value.evidence)))
    || !Array.isArray(value.warnings) || value.warnings.some(warning => typeof warning !== 'string')
    || !value.timings_ms || typeof value.timings_ms !== 'object'
    || Object.values(value.timings_ms).some(timing => !Number.isFinite(timing) || timing < 0)) {
    throw new ApiError('ocr-invalid-response', 502);
  }
  return {
    status: value.status,
    amount: value.amount,
    suggested_amount: value.suggested_amount,
    currency: 'VND',
    needs_confirmation: true,
    evidence: value.evidence,
    warnings: value.warnings,
    timings_ms: value.timings_ms,
  };
}

export function createReceiptScanService(repository, config, fetchImpl = fetch, clock = Date.now) {
  return {
    async scan({ uid, roomId, buffer, contentType }) {
      if (!supportedTypes.has(contentType) || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new ApiError('invalid-image', 415);
      }
      if (buffer.length > maxImageBytes) throw new ApiError('image-too-large', 413);
      if (typeof roomId !== 'string' || !roomIdPattern.test(roomId)) throw new ApiError('invalid-argument', 400);

      let user;
      try { user = await repository.getUser(uid); }
      catch { throw new ApiError('unavailable', 503); }
      const expiresAt = timestampMillis(user?.premiumExpiresAt);
      if (expiresAt === null || expiresAt <= clock()) throw new ApiError('premium-required', 403);

      let room;
      let member;
      try {
        [room, member] = await Promise.all([repository.getRoom(roomId), repository.getMember(roomId, uid)]);
      } catch {
        throw new ApiError('unavailable', 503);
      }
      if (!room || room.hostId !== uid || !member || member.role !== 'HOST' || member.status !== 'ACTIVE') {
        throw new ApiError('host-required', 403);
      }
      if (room.status !== 'COMPLETED' || room.reconciliationStatus !== 'FINALIZED') {
        throw new ApiError('failed-precondition', 409);
      }
      if (!config.paddleOcrUrl || !config.paddleOcrApiKey) throw new ApiError('ocr-unavailable', 503);

      const form = new FormData();
      const extension = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
      form.set('image', new Blob([buffer], { type: contentType }), `receipt.${extension}`);
      let response;
      try {
        response = await fetchImpl(config.paddleOcrUrl, {
          method: 'POST', headers: { 'X-API-Key': config.paddleOcrApiKey }, body: form,
          signal: AbortSignal.timeout(config.paddleOcrTimeoutMs ?? 60_000),
        });
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new ApiError('ocr-timeout', 504);
        throw new ApiError('ocr-unavailable', 503);
      }
      if (!response.ok) throw new ApiError('ocr-unavailable', 503);
      let payload;
      try { payload = await response.json(); }
      catch { throw new ApiError('ocr-invalid-response', 502); }
      return checkedScanResult(payload);
    },
  };
}
