import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';

import { PlatformService } from '@server/services/platform-service';
import { StoreService } from '@server/services/store-service';

describe('Owner print settings', () => {
  let storeId: string;
  let storeService: StoreService;

  beforeAll(async () => {
    const platform = new PlatformService(env);
    const store = await platform.createStore({
      name: 'Print Settings Store',
      ownerDisplayName: 'Print Owner',
      ownerEmail: 'print.owner@example.com',
    });
    storeId = store.storeId;
    storeService = new StoreService(env);
  });

  it('returns default print settings when none exist', async () => {
    const settings = await storeService.getPrintSettings(storeId);
    expect(settings).toMatchObject({
      storeId,
      maxReceiptReprintCount: 0,
      paymentCopyCount: 1,
      allowProvisionalPrint: true,
      provisionalCopyCount: 1,
      logoHorizontalLayout: false,
      bottomImageType: 'UPLOAD',
      paperSize: 'K80',
    });
  });

  it('updates and persists store print settings', async () => {
    expect(await storeService.getPrintConfigVersion(storeId)).toBe(0);
    const updateResult = await storeService.updatePrintSettings({
      storeId,
      maxReceiptReprintCount: 3,
      paymentCopyCount: 2,
      allowProvisionalPrint: true,
      provisionalCopyCount: 2,
      logoHorizontalLayout: true,
      logoMediaId: null,
      bottomImageDescription: 'Quét mã thanh toán',
      bottomImageType: 'VIETQR',
      bottomImageMediaId: null,
      bottomBankName: 'MBBANK',
      bottomBankAccountNumber: '0987654321',
      bottomBankAccountName: 'NGUYEN VAN A',
      customAddressEnabled: true,
      customAddress: '123 Đường Trần Phú, Đà Nẵng',
      footerLine1: 'Hẹn gặp lại quý khách!',
      footerLine1Bold: true,
      footerLine2: 'Hệ thống Pro POS',
      footerLine2Bold: true,
      printWifiEnabled: true,
      wifiName: 'Store_Wifi_5G',
      wifiPassword: 'password123',
      paperSize: 'K58',
      printersJson: null,
      templateConfigJson: JSON.stringify({
        PROVISIONAL: {
          showLogo: false,
          showCashierName: false,
          itemFontSize: 'SMALL',
          showItemTableBorder: true,
        },
        PAYMENT: {
          showLogo: true,
          showCashierName: true,
          itemFontSize: 'LARGE',
          showItemTableBorder: false,
        },
      }),
    });
    expect(updateResult).toEqual({ storeId, updated: true });

    const updated = await storeService.getPrintSettings(storeId);
    expect(updated).toMatchObject({
      storeId,
      maxReceiptReprintCount: 3,
      paymentCopyCount: 2,
      allowProvisionalPrint: true,
      provisionalCopyCount: 2,
      logoHorizontalLayout: true,
      bottomImageDescription: 'Quét mã thanh toán',
      bottomImageType: 'VIETQR',
      bottomBankName: 'MBBANK',
      bottomBankAccountNumber: '0987654321',
      bottomBankAccountName: 'NGUYEN VAN A',
      customAddressEnabled: true,
      customAddress: '123 Đường Trần Phú, Đà Nẵng',
      footerLine1: 'Hẹn gặp lại quý khách!',
      footerLine1Bold: true,
      footerLine2: 'Hệ thống Pro POS',
      footerLine2Bold: true,
      printWifiEnabled: true,
      wifiName: 'Store_Wifi_5G',
      wifiPassword: 'password123',
      paperSize: 'K58',
    });
    const parsedTemplates = JSON.parse(updated.templateConfigJson!);
    expect(parsedTemplates.PROVISIONAL).toMatchObject({
      showLogo: false,
      showCashierName: false,
      itemFontSize: 'SMALL',
      showItemTableBorder: true,
    });
    expect(parsedTemplates.PAYMENT).toMatchObject({
      showLogo: true,
      showCashierName: true,
      itemFontSize: 'LARGE',
      showItemTableBorder: false,
    });
    expect(await storeService.getPrintConfigVersion(storeId)).toBe(1);
    const event = await env.DB.prepare(
      `SELECT event_type AS eventType, aggregate_type AS aggregateType,
              aggregate_id AS aggregateId, aggregate_version AS aggregateVersion,
              data_json AS dataJson
       FROM realtime_events
       WHERE store_id = ? AND event_type = 'pos.print_config.updated'
       ORDER BY sequence DESC LIMIT 1`,
    )
      .bind(storeId)
      .first<{
        eventType: string;
        aggregateType: string;
        aggregateId: string;
        aggregateVersion: number;
        dataJson: string;
      }>();
    expect(event).toMatchObject({
      eventType: 'pos.print_config.updated',
      aggregateType: 'STORE',
      aggregateId: storeId,
      aggregateVersion: 1,
    });
    expect(JSON.parse(event!.dataJson)).toMatchObject({
      reason: 'PRINT_CONFIG_UPDATED',
      configVersion: 1,
    });
  });

  it('correctly provides K80 and K58 physical and printable dot profiles', async () => {
    const { getReceiptPrintProfile, parsePrinterDeviceConfig } = await import('@contracts/store');

    const k80Profile = getReceiptPrintProfile('K80');
    expect(k80Profile).toMatchObject({
      paperSize: 'K80',
      paperWidthMm: 80,
      printableWidthMm: 72,
      defaultPrintableDots: 576,
      dpi: 203,
      charsPerLineFontA: 48,
      layoutMode: 'MULTI_COLUMN',
    });

    const k58Profile = getReceiptPrintProfile('K58');
    expect(k58Profile).toMatchObject({
      paperSize: 'K58',
      paperWidthMm: 58,
      printableWidthMm: 52.5,
      defaultPrintableDots: 420,
      dpi: 203,
      charsPerLineFontA: 35,
      layoutMode: 'COMPACT_STACK',
    });

    // Custom dots override for calibration
    const customProfile = getReceiptPrintProfile('K80', 640);
    expect(customProfile.defaultPrintableDots).toBe(640);

    // Printer device config parsing
    const parsedDevice = parsePrinterDeviceConfig(
      JSON.stringify({
        connectionType: 'NETWORK_TCP',
        networkIp: '192.168.1.200',
        networkPort: 9100,
        paperSize: 'K58',
        printableDots: 384,
        autoCut: true,
        openCashDrawer: false,
      }),
    );
    expect(parsedDevice).toMatchObject({
      connectionType: 'NETWORK_TCP',
      networkIp: '192.168.1.200',
      networkPort: 9100,
      paperSize: 'K58',
      printableDots: 384,
      autoCut: true,
      openCashDrawer: false,
    });
  });

  it('builds receipt data from quote and formats ESC/POS commands correctly', async () => {
    const { buildPrintDataFromQuote, buildEscPosReceipt } =
      await import('@domain/receipt/receipt-generator');

    const mockQuote = {
      order: {
        id: 'ord-123456',
        displayCode: 'HD-0001',
        orderType: 'DINE_IN' as const,
        tableName: 'Bàn 01',
        areaName: 'Tầng 1',
        cashierName: 'Thu Ngân A',
        guestPhone: '0901234567',
        guestAddress: '123 Phố Huế',
        note: 'Khách quen',
        openedAt: 1720000000000,
      },
      items: [
        {
          id: 'item-1',
          productName: 'Cà phê sữa',
          quantityMilli: 2000,
          unitPriceVnd: 25000,
          netLineTotalVnd: 50000,
          unitName: 'Ly',
          note: 'Ít đường',
        },
      ],
      time: {
        startedAtMs: 1720000000000,
        endedAtMs: 1720003600000,
        elapsedSeconds: 3600,
        amountAfterRoundingVnd: 60000,
        pricingConfig: { basePriceVnd: 60000 },
      },
      totals: {
        subtotalVnd: 110000,
        discountTotalVnd: 10000,
        totalVnd: 100000,
      },
    };

    // 1. Provisional Bill
    const provData = buildPrintDataFromQuote(mockQuote, 'PROVISIONAL');
    expect(provData.receiptType).toBe('PROVISIONAL');
    expect(provData.total).toBe(100000);
    expect(provData.lines.length).toBe(2);

    const provResult = buildEscPosReceipt({
      data: provData,
      storeInfo: { storeName: 'Quán Cafe Test', phone: '0988888888' },
    });
    expect(provResult.escPosData).toContain('HÓA ĐƠN TẠM TÍNH');
    expect(provResult.escPosData).toContain('Liên 1/1');
    expect(provResult.escPosData).toContain('Bàn 01');
    expect(provResult.escPosData).toContain('Thông tin giờ');
    expect(provResult.escPosData).toContain('Mặt hàng');
    expect(provResult.escPosData).toContain('Cà phê sữa');
    expect(provResult.escPosData).toContain('Tổng hàng & dịch vụ:');

    // 2. Payment Receipt
    const payData = buildPrintDataFromQuote(mockQuote, 'PAYMENT', 'CASH', 200000);
    expect(payData.receiptType).toBe('PAYMENT');
    expect(payData.paymentMethod).toBe('CASH');
    expect(payData.cashReceived).toBe(200000);
    expect(payData.cashChange).toBe(100000);

    const payResult = buildEscPosReceipt({
      data: payData,
      storeInfo: { storeName: 'Quán Cafe Test', phone: '0988888888' },
    });
    expect(payResult.escPosData).toContain('HÓA ĐƠN THANH TOÁN');
    expect(payResult.escPosData).toContain('Thông tin giờ');
    expect(payResult.escPosData).toContain('Mặt hàng');
    expect(payResult.escPosData).toContain('Hình thức thanh toán: Tiền mặt');
    expect(payResult.escPosData).toContain('200.000đ');
  });
});
