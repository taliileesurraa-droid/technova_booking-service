const assert = require('assert');

describe('financeService', () => {
  const finance = require('../services/financeService');

  describe('calculatePackage', () => {
    it('uses formula providerAmount * (100 / commissionRate) when rate > 0', () => {
      const result = finance.calculatePackage(100, 20); // 100 * (100/20) = 500
      assert.strictEqual(result, 500);
    });
  });

  describe('calculateCommission', () => {
    it('computes commission = (finalFare * commissionRate) / 100', () => {
      const result = finance.calculateCommission(1000, 15); // 1000*15/100 = 150
      assert.strictEqual(result, 150);
    });
  });

  // Removed per-trip net income test; use totals instead

  describe('calculateNetIncomeTotals', () => {
    it('computes totals net income = totalFinalFare - totalCommission', () => {
      const net = finance.calculateNetIncomeTotals(10000, 1500);
      assert.strictEqual(net, 8500);
    });
    it('handles zeros and negatives gracefully', () => {
      assert.strictEqual(finance.calculateNetIncomeTotals(0, 0), 0);
      assert.strictEqual(finance.calculateNetIncomeTotals(5000, 0), 5000);
      assert.strictEqual(finance.calculateNetIncomeTotals(5000, -100), 5100);
    });
  });

  describe('canAcceptBooking', () => {
    it('returns true when packageBalance > estimatefare', () => {
      assert.strictEqual(finance.canAcceptBooking(200, 150), true);
    });
    it('returns false when packageBalance < esttimatesare', () => {
      assert.strictEqual(finance.canAcceptBooking(100, 150), false);
      assert.strictEqual(finance.canAcceptBooking(150, 150), false);
    });
  });
});

