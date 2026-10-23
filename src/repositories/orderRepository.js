import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { ApiError } from '../domain/apiError.js';
import { extendPremium } from '../domain/premiumCalendar.js';

export function publicOrder(row) {
  return { version: 1, requestId: row.requestId, orderCode: row.orderCode, packageId: row.packageId, amountVnd: row.amountVnd,
    status: row.status, checkoutUrl: row.checkoutUrl ?? null, qrCode: row.qrCode ?? null,
    premiumExpiresAtUtcMs: row.grantedExpiresAt?.toMillis() ?? null };
}
export function createOrderStore(db, clock = Date.now) {
  const ref = code => db.doc(`premiumOrders/${code}`);
  return {
    async get(code) { const doc = await ref(code).get(); return doc.exists ? doc.data() : null; },
    async current(uid) {
      const pointer = await db.doc(`premiumCurrentOrders/${uid}`).get();
      if (!pointer.exists) return null;
      const order = await ref(pointer.data().orderCode).get();
      return order.exists ? order.data() : null;
    },
    async reserve(uid, requestId, pack) {
      const key = createHash('sha256').update(`${uid}:${requestId}`).digest('hex');
      const requestRef = db.doc(`premiumOrderRequests/${key}`);
      const currentRef = db.doc(`premiumCurrentOrders/${uid}`);
      // Mã 7 chữ số cho description DLxxxxxxx duy nhất và nằm trong giới hạn 9 ký tự payOS.
      const code = randomInt(1000000, 10000000);
      const lease = randomUUID();
      return db.runTransaction(async tx => {
        const saved = await tx.get(requestRef);
        const now = clock();
        if (saved.exists) {
          if (saved.data().packageId !== pack.id) throw new ApiError('conflict', 409);
          const existing = await tx.get(ref(saved.data().orderCode));
          if (!existing.exists) throw new ApiError('unavailable', 503);
          const order = existing.data();
          if (order.status !== 'CREATING' || order.leaseUntil > now) return { order, owned: false };
          tx.update(existing.ref, { lease, leaseUntil: now + 20000 });
          return { order: { ...order, lease }, owned: true };
        }
        const [current, collision] = await Promise.all([tx.get(currentRef), tx.get(ref(code))]);
        if (collision.exists) throw new ApiError('unavailable', 503);
        // Giới hạn tạo mới được lưu trong Firestore, không mất khi host restart.
        if (current.exists && now - current.data().createdAtMs < 10000) throw new ApiError('rate-limited', 429);
        const order = { uid, requestId, orderCode: code, packageId: pack.id, amountVnd: pack.amountVnd,
          grantedMonths: pack.grantedMonths, paidMonths: pack.paidMonths, status: 'CREATING',
          lease, leaseUntil: now + 20000, createdAt: FieldValue.serverTimestamp() };
        tx.create(ref(code), order);
        tx.create(requestRef, { uid, packageId: pack.id, orderCode: code });
        tx.set(currentRef, { orderCode: code, createdAtMs: now });
        return { order, owned: true, fresh: true };
      });
    },
    async saveLink(code, link) {
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref(code));
        const row = snapshot.data();
        if (!row) throw new ApiError('not-found', 404);
        // Webhook có thể đã commit PAID trước response tạo link; không ghi đè nó.
        if (row.status === 'PAID') return row;
        const patch = { checkoutUrl: link.checkoutUrl, qrCode: link.qrCode, paymentLinkId: link.paymentLinkId,
          status: ['CANCELLED', 'EXPIRED'].includes(link.status) ? link.status : 'PENDING', updatedAt: FieldValue.serverTimestamp() };
        tx.update(snapshot.ref, patch);
        return { ...row, ...patch };
      });
    },
    async refreshStatus(code, payos) {
      const shouldCheck = await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref(code));
        const row = snapshot.data();
        if (!row || row.status !== 'PENDING' || clock() - (row.checkedAtMs ?? 0) < 10000) return false;
        tx.update(snapshot.ref, { checkedAtMs: clock() });
        return true;
      });
      if (!shouldCheck) return;
      const link = await payos.get(code);
      if (['CANCELLED', 'EXPIRED'].includes(link.status)) {
        await db.runTransaction(async tx => {
          const snapshot = await tx.get(ref(code));
          const row = snapshot.data();
          if (row?.status === 'PENDING' && link.id === row.paymentLinkId && link.amount === row.amountVnd) {
            tx.update(snapshot.ref, { status: link.status, updatedAt: FieldValue.serverTimestamp() });
          }
        });
      }
    },
    async releaseLease(code, lease) {
      await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref(code));
        if (snapshot.exists && snapshot.data().lease === lease && snapshot.data().status === 'CREATING') {
          tx.update(snapshot.ref, { leaseUntil: 0 });
        }
      });
    },
    async grant(code, paymentLinkId) {
      return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref(code));
        if (!snapshot.exists) throw new ApiError('not-found', 404);
        const order = snapshot.data();
        if (order.status === 'PAID') return order;
        if (order.paymentLinkId && order.paymentLinkId !== paymentLinkId) throw new ApiError('payment-mismatch');
        const userRef = db.doc(`users/${order.uid}`);
        const user = await tx.get(userRef);
        if (!user.exists) throw new ApiError('unavailable', 503);
        const prior = user.data().premiumExpiresAt;
        const expiresAt = Timestamp.fromMillis(extendPremium(clock(), prior instanceof Timestamp ? prior.toMillis() : null, order.grantedMonths));
        const patch = { status: 'PAID', paymentLinkId, grantedExpiresAt: expiresAt,
          paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
        // Receipt và entitlement cùng transaction để webhook trùng không cộng tháng hai lần.
        tx.update(userRef, { isPremium: true, premiumExpiresAt: expiresAt, updatedAt: FieldValue.serverTimestamp() });
        tx.update(snapshot.ref, patch);
        return { ...order, ...patch };
      });
    },
  };
}
