import { describe, expect, it } from 'vitest';

import {
  defaultPaymentPrintTemplateConfig,
  defaultProvisionalPrintTemplateConfig,
  parsePrintTemplateConfigs,
} from '../../src/contracts/store';

describe('print template configuration isolation', () => {
  it('uses safe receipt-specific defaults for a new store', () => {
    const configs = parsePrintTemplateConfigs(null);

    expect(configs.PROVISIONAL).toMatchObject({
      showPaymentMethod: false,
      showCashDetails: false,
      showBottomImage: false,
      showCustomerAddress: false,
    });
    expect(configs.PAYMENT).toMatchObject({
      showPaymentMethod: true,
      showCashDetails: true,
      showBottomImage: true,
      showCustomerAddress: false,
    });
    expect(configs.PROVISIONAL).toEqual(defaultProvisionalPrintTemplateConfig);
    expect(configs.PAYMENT).toEqual(defaultPaymentPrintTemplateConfig);
    expect(configs.PROVISIONAL).not.toBe(configs.PAYMENT);
  });

  it('never leaks a checkbox value between provisional and payment templates', () => {
    const configs = parsePrintTemplateConfigs(
      JSON.stringify({
        PROVISIONAL: { showBottomImage: false, showLogo: false },
        PAYMENT: { showBottomImage: true, showLogo: true },
      }),
    );

    expect(configs.PROVISIONAL.showBottomImage).toBe(false);
    expect(configs.PAYMENT.showBottomImage).toBe(true);
    expect(configs.PROVISIONAL.showLogo).toBe(false);
    expect(configs.PAYMENT.showLogo).toBe(true);

    configs.PROVISIONAL.showBottomImage = true;
    expect(configs.PAYMENT.showBottomImage).toBe(true);
  });

  it('fills missing fields independently when loading older saved JSON', () => {
    const configs = parsePrintTemplateConfigs(JSON.stringify({ PROVISIONAL: { showLogo: false } }));

    expect(configs.PROVISIONAL.showLogo).toBe(false);
    expect(configs.PROVISIONAL.showPaymentMethod).toBe(false);
    expect(configs.PAYMENT).toEqual(defaultPaymentPrintTemplateConfig);
  });
});
