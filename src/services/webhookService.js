import { ApiError } from '../domain/apiError.js';

export function createWebhookService(store, payos) {
  return async body => {
    let data;
    try { data = await payos.verify(body); } catch { throw new ApiError('invalid-signature'); }
    if (body.code !== '00' || body.success !== true || data.code !== '00') return;
    const order = await store.get(data.orderCode);
    if (!order) return; // Probe đăng ký webhook đã ký hợp lệ, không tạo entitlement.
    if (data.currency !== 'VND' || data.amount !== order.amountVnd
      || (order.paymentLinkId && order.paymentLinkId !== data.paymentLinkId)) throw new ApiError('payment-mismatch');
    let link;
    try { link = await payos.get(data.orderCode); } catch { throw new ApiError('unavailable', 503); }
    if (link.status !== 'PAID' || link.orderCode !== data.orderCode || link.id !== data.paymentLinkId || link.amount !== order.amountVnd
      || link.amountPaid !== order.amountVnd) throw new ApiError('payment-mismatch');
    await store.grant(order.orderCode, link.id);
  };
}
