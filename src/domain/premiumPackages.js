export const packages = Object.freeze([
  { id: 'MONTH_1', amountVnd: 89000, paidMonths: 1, grantedMonths: 1 },
  { id: 'MONTH_3', amountVnd: 178000, paidMonths: 2, grantedMonths: 3 },
  { id: 'MONTH_6', amountVnd: 356000, paidMonths: 4, grantedMonths: 6 },
  { id: 'MONTH_12', amountVnd: 623000, paidMonths: 7, grantedMonths: 12 },
]);
export const packageById = id => packages.find(item => item.id === id);
