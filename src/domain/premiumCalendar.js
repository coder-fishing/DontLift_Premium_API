export function extendPremium(nowMs, previousMs, months) {
  if (!Number.isFinite(nowMs) || !Number.isInteger(months) || months < 1)
    throw new Error("invalid-calendar-input");
  // Lịch Việt Nam UTC+7, clamp ngày thay vì để Date tự tràn sang tháng kế tiếp.
  const offset = 7 * 3600000;
  const date = new Date(Math.max(nowMs, previousMs ?? 0) + offset);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime() - offset;
}
