import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '../domain/apiError.js';

function profileReference(db, uid) {
  return db.doc(`users/${uid}`);
}

function cleanupReference(db, uid, publicId) {
  const id = createHash('sha256').update(publicId).digest('hex');
  return db.doc(`users/${uid}/avatarCleanup/${id}`);
}

function validPublicId(uid, publicId) {
  return typeof publicId === 'string' && publicId.startsWith(`avatars/${uid}/`)
    && /^[A-Za-z0-9_/-]+$/.test(publicId);
}

export function createAvatarProfileRepository(db) {
  async function queue(transaction, uid, publicId) {
    if (!validPublicId(uid, publicId)) return;
    const reference = cleanupReference(db, uid, publicId);
    transaction.set(reference, { publicId, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  return {
    async replaceAvatar({ uid, url, publicId }) {
      if (!validPublicId(uid, publicId) || typeof url !== 'string' || !url.startsWith('https://')) {
        throw new ApiError('invalid-image', 400);
      }
      const reference = profileReference(db, uid);
      await db.runTransaction(async transaction => {
        const profile = await transaction.get(reference);
        if (!profile.exists) throw new ApiError('not-found', 404);
        const previousPublicId = profile.data()?.avatarPublicId;
        transaction.update(reference, {
          avatarUri: url,
          avatarPublicId: publicId,
          updatedAt: FieldValue.serverTimestamp(),
        });
        if (previousPublicId !== publicId) await queue(transaction, uid, previousPublicId);
      });
    },

    async removeAvatar(uid) {
      const reference = profileReference(db, uid);
      await db.runTransaction(async transaction => {
        const profile = await transaction.get(reference);
        if (!profile.exists) throw new ApiError('not-found', 404);
        const previousPublicId = profile.data()?.avatarPublicId;
        transaction.update(reference, {
          avatarUri: FieldValue.delete(),
          avatarPublicId: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        await queue(transaction, uid, previousPublicId);
      });
    },

    async queueAvatarCleanup(uid, publicId) {
      if (!validPublicId(uid, publicId)) return;
      await cleanupReference(db, uid, publicId).set({ publicId, createdAt: FieldValue.serverTimestamp() }, { merge: true });
    },

    async listAvatarCleanup(uid) {
      const snapshot = await db.collection(`users/${uid}/avatarCleanup`).get();
      return snapshot.docs.map(document => ({ id: document.id, publicId: document.data().publicId }));
    },

    async completeAvatarCleanup(uid, id) {
      if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) return;
      await db.doc(`users/${uid}/avatarCleanup/${id}`).delete();
    },
  };
}
