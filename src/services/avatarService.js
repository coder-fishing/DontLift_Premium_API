import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '../domain/apiError.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const supportedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function matchesImageType(buffer, contentType) {
  if (contentType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (contentType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (contentType === 'image/webp') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function validUid(uid) {
  return typeof uid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(uid);
}

function validPublicId(uid, publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`avatars/${uid}/`)
    && /^[A-Za-z0-9_/-]+$/.test(publicId);
}

function signParameters(parameters, apiSecret) {
  const serialized = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

export function createAvatarService(cloudinary, profiles, fetchImpl = fetch, createId = randomUUID) {
  async function destroyAsset(uid, publicId) {
    if (!cloudinary || !validPublicId(uid, publicId)) return false;
    const timestamp = Math.floor(Date.now() / 1000);
    const parameters = { invalidate: 'true', public_id: publicId, timestamp };
    const form = new FormData();
    for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
    form.set('api_key', cloudinary.apiKey);
    form.set('signature', signParameters(parameters, cloudinary.apiSecret));

    let response;
    try {
      response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinary.cloudName)}/image/destroy`, {
        method: 'POST', body: form, signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return false;
    }
    const result = await response.json().catch(() => null);
    return response.ok && (result?.result === 'ok' || result?.result === 'not found');
  }

  async function drainCleanup(uid) {
    if (!profiles || !validUid(uid)) return true;
    const pending = await profiles.listAvatarCleanup(uid);
    for (const entry of pending) {
      if (!validPublicId(uid, entry.publicId)) continue;
      if (await destroyAsset(uid, entry.publicId)) {
        await profiles.completeAvatarCleanup(uid, entry.id);
      }
    }
    return (await profiles.listAvatarCleanup(uid)).length > 0;
  }

  return {
    async upload({ uid, buffer, contentType }) {
      if (!validUid(uid)) throw new ApiError('invalid-user', 400);
      if (!supportedTypes.has(contentType)) throw new ApiError('unsupported-image-type', 415);
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ApiError('image-required', 400);
      if (buffer.length > MAX_AVATAR_BYTES) throw new ApiError('image-too-large', 413);
      if (!matchesImageType(buffer, contentType)) throw new ApiError('invalid-image', 400);
      if (!cloudinary) throw new ApiError('avatar-upload-unavailable', 503);
      if (!profiles) throw new ApiError('avatar-upload-unavailable', 503);

      await drainCleanup(uid);
      const publicId = `avatars/${uid}/${createId()}`;
      const timestamp = Math.floor(Date.now() / 1000);
      const parameters = { overwrite: 'false', public_id: publicId, timestamp };
      const form = new FormData();
      form.set('file', new Blob([buffer], { type: contentType }), `avatar.${contentType.split('/')[1]}`);
      for (const [key, value] of Object.entries(parameters)) form.set(key, String(value));
      form.set('api_key', cloudinary.apiKey);
      form.set('signature', signParameters(parameters, cloudinary.apiSecret));

      let response;
      try {
        response = await fetchImpl(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudinary.cloudName)}/image/upload`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new ApiError('avatar-upload-unavailable', 503);
      }

      const uploaded = await response.json().catch(() => null);
      if (!response.ok || typeof uploaded?.secure_url !== 'string' || !uploaded.secure_url.startsWith('https://')
        || uploaded.public_id !== publicId) {
        throw new ApiError('avatar-upload-failed', 502);
      }

      try {
        await profiles.replaceAvatar({ uid, url: uploaded.secure_url, publicId });
      } catch {
        try { await profiles.queueAvatarCleanup(uid, publicId); }
        catch { await destroyAsset(uid, publicId); }
        await drainCleanup(uid).catch(() => undefined);
        throw new ApiError('avatar-profile-update-failed', 503);
      }

      const cleanupPending = await drainCleanup(uid).catch(() => true);
      return { url: uploaded.secure_url, publicId, cleanupPending };
    },

    async remove({ uid }) {
      if (!validUid(uid)) throw new ApiError('invalid-user', 400);
      if (!profiles) throw new ApiError('avatar-remove-unavailable', 503);
      await profiles.removeAvatar(uid);
      const cleanupPending = await drainCleanup(uid).catch(() => true);
      return { removed: true, cleanupPending };
    },
  };
}
