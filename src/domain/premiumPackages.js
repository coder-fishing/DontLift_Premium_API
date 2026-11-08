export const packages = Object.freeze([
  { id: 'MONTH_1', amountVnd: 30000, paidMonths: 1, grantedMonths: 1 },
  { id: 'MONTH_3', amountVnd: 79000, paidMonths: 3, grantedMonths: 4 },
  { id: 'MONTH_6', amountVnd: 149000, paidMonths: 6, grantedMonths: 8 },
  { id: 'MONTH_12', amountVnd: 249000, paidMonths: 12, grantedMonths: 16 },
]);
export const packageById = id => packages.find(item => item.id === id);
