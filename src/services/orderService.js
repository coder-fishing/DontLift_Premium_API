import { ApiError } from '../domain/apiError.js';
import { packageById } from '../domain/premiumPackages.js';
import { publicOrder } from '../repositories/orderRepository.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createOrderService(store, payos, baseUrl) {
  async function attachQr(order) {
    if (!order || order.status !== 'PENDING' || order.qrCode || !order.paymentLinkId) return publicOrder(order);
    try {
      const link = await payos.get(order.orderCode);
      if (link.id !== order.paymentLinkId || link.amount !== order.amountVnd || typeof link.qrCode !== 'string' || !link.qrCode) return publicOrder(order);
      const updated = await store.saveLink(order.orderCode, {
        checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(link.id)}`,
        qrCode: link.qrCode,
        paymentLinkId: link.id,
        status: link.status,
      });
      return publicOrder(updated);
    } catch {
      // Giữ trạng thái đơn khả dụng; màn hình vẫn có thể mở checkoutUrl nếu QR chưa tải được.
      return publicOrder(order);
    }
  }
  async function create(uid, body) {
    const pack = packageById(body.packageId);
    if (body.version !== 1 || !uuid.test(body.requestId ?? '') || !pack
      || Object.keys(body).some(key => !['version', 'requestId', 'packageId'].includes(key))) throw new ApiError('invalid-argument');
    const { order, owned, fresh } = await store.reserve(uid, body.requestId, pack);
    if (!owned) return attachQr(order);
    try {
      // Retry cùng mã đơn sau timeout; tra cứu trước để phục hồi link đã tạo bên payOS.
      let saved;
      try { if (!fresh) saved = await payos.get(order.orderCode); }
      catch (error) { if (error.code !== '231' && error.status !== 404) throw error; }
      if (saved) {
        if (saved.orderCode !== order.orderCode || saved.amount !== order.amountVnd || typeof saved.id !== 'string'
          || typeof saved.qrCode !== 'string' || !saved.qrCode) throw new ApiError('unavailable', 503);
        const link = { checkoutUrl: `https://pay.payos.vn/web/${encodeURIComponent(saved.id)}`, qrCode: saved.qrCode,
          paymentLinkId: saved.id, status: saved.status };
        return publicOrder(await store.saveLink(order.orderCode, link));
      }
      const link = await payos.create({ orderCode: order.orderCode, amount: order.amountVnd,
        description: `DL${String(order.orderCode).slice(-7).padStart(7, '0')}`,
        items: [{ name: `DontLift Premium ${order.grantedMonths} months`, quantity: 1, price: order.amountVnd }],
        returnUrl: `${baseUrl}/checkout/return`, cancelUrl: `${baseUrl}/checkout/cancel` });
      if (link.orderCode !== order.orderCode || link.amount !== order.amountVnd || link.currency !== 'VND'
        || typeof link.paymentLinkId !== 'string' || typeof link.qrCode !== 'string' || !link.qrCode
        || !/^https:\/\/pay\.payos\.vn\//.test(link.checkoutUrl)) throw new ApiError('unavailable', 503);
      return publicOrder(await store.saveLink(order.orderCode, link));
    } catch (error) {
      await store.releaseLease(order.orderCode, order.lease).catch(() => undefined);
      throw error instanceof ApiError ? error : new ApiError('unavailable', 503);
    }
  }
  async function resumeIfLeaseExpired(uid, order) {
    if (order?.status === 'CREATING' && !(order.leaseUntil > Date.now())) {
      // Dùng lại request idempotent để nhận lease hết hạn và tìm link cũ trên payOS trước.
      return create(uid, { version: 1, requestId: order.requestId, packageId: order.packageId });
    }
    return attachQr(order);
  }
  return {
    create,
    async get(uid, code) {
      if (!/^\d{1,15}$/.test(String(code))) throw new ApiError('invalid-argument');
      const order = await store.get(Number(code));
      if (!order || order.uid !== uid) throw new ApiError('not-found', 404);
      await store.refreshStatus(order.orderCode, payos).catch(() => undefined);
      return resumeIfLeaseExpired(uid, await store.get(order.orderCode));
    },
    async current(uid) {
      const order = await store.current(uid);
      if (!order || order.uid !== uid) return null;
      await store.refreshStatus(order.orderCode, payos).catch(() => undefined);
      return resumeIfLeaseExpired(uid, await store.get(order.orderCode));
    },
  };
}
