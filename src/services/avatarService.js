import { createHash } from 'node:crypto';
import { ApiError } from '../domain/apiError.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function matchesImageType(buffer, contentType) {
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function signParameters(parameters, apiSecret) {
  const serialized = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

export function createAvatarService(cloudinary, fetchImpl = fetch) {
  return {
    async upload({ uid, buffer, contentType }) {
      if (!cloudinary) throw new ApiError('avatar-upload-unavailable', 503);
      if (!supportedTypes.has(contentType)) throw new ApiError('unsupported-image-type', 415);
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError('image-required', 400);
      if (buffer.length > MAX_AVATAR_BYTES) throw new ApiError('image-too-large', 413);
      if (!matchesImageType(buffer, contentType)) throw new ApiError('invalid-image', 400);
      if (!/^[A-Za-z0-9_-]+$/.test(uid)) throw new ApiError('invalid-user', 400);

      const timestamp = Math.floor(Date.now() / 1000);
      const parameters = { overwrite: 'true', public_id: `avatars/${uid}`, timestamp };
      const form = new FormData();
      form.set('file', new Blob([buffer], { type: contentType }), `avatar.${contentType.split('/')[1]}`);
      for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
      form.set('api_key', cloudinary.apiKey);
      form.set('signature', signParameters(parameters, cloudinary.apiSecret));

      let response;
      try {
        response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinary.cloudName)}/image/upload`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(20_000)
        });
      } catch {
        throw new ApiError('avatar-upload-unavailable', 503);
      }

      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.secure_url !== 'string' || typeof result?.public_id !== 'string') {
        throw new ApiError('avatar-upload-failed', 502);
      }
      return { url: result.secure_url, publicId: result.public_id };
    }
  };
}
