export function createReceiptScanRepository(db) {
  return {
    async getUser(uid) {
      const snapshot = await db.doc(`users/${uid}`).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async getRoom(roomId) {
      const snapshot = await db.doc(`rooms/${roomId}`).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async getMember(roomId, uid) {
      const snapshot = await db.doc(`rooms/${roomId}/members/${uid}`).get();
      return snapshot.exists ? snapshot.data() : null;
    },
  };
}
