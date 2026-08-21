import { AppError } from '@server/lib/app-error';
import { StoreRepository } from '@server/repositories/store-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';

export class StoreService {
  private readonly repository: StoreRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new StoreRepository(env.DB);
  }

  getSettings(storeId: string) {
    return this.repository.getSettings(storeId);
  }

  async updateSettings(input: {
    storeId: string;
    name: string;
    phone: string | null;
    address: string | null;
    cutoff: number;
    bankName: string | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    bankQrMediaId: string | null;
    provinceCode: number | null;
    provinceName: string | null;
    wardCode: number | null;
    wardName: string | null;
    auditContext?: AuditContext;
  }) {
    if (
      input.bankQrMediaId &&
      !(await this.repository.findActiveBankQrMedia(input.storeId, input.bankQrMediaId))
    ) {
      throw new AppError('BANK_QR_MEDIA_NOT_FOUND', 'Không tìm thấy ảnh QR ngân hàng.', 404);
    }
    const before = input.auditContext ? await this.repository.getSettings(input.storeId) : null;
    const now = Date.now();
    await this.repository.updateSettings({ ...input, now });
    if (input.auditContext) {
      const after = await this.repository.getSettings(input.storeId);
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'STORE_SETTINGS_UPDATED',
        entityType: 'STORE',
        entityId: input.storeId,
        before,
        after,
        now,
      });
    }
    return { storeId: input.storeId, updated: true };
  }

  async listAuditLogs(storeId: string) {
    const result = await this.repository.listAuditLogs(storeId, 100);
    return result.results;
  }

  async getPrintSettings(storeId: string) {
    const raw = (await this.repository.getPrintSettings(storeId)) as Record<string, unknown> | null;
    if (raw) {
      return {
        storeId: raw.storeId as string,
        maxReceiptReprintCount: Number(raw.maxReceiptReprintCount ?? 0),
        paymentCopyCount: Number(raw.paymentCopyCount ?? 1),
        allowProvisionalPrint: Boolean(raw.allowProvisionalPrint),
        provisionalCopyCount: Number(raw.provisionalCopyCount ?? 1),
        logoHorizontalLayout: Boolean(raw.logoHorizontalLayout),
        logoMediaId: (raw.logoMediaId as string) || null,
        bottomImageDescription: (raw.bottomImageDescription as string) || null,
        bottomImageType: (raw.bottomImageType as 'UPLOAD' | 'VIETQR' | 'NONE') || 'UPLOAD',
        bottomImageMediaId: (raw.bottomImageMediaId as string) || null,
        bottomBankName: (raw.bottomBankName as string) || null,
        bottomBankAccountNumber: (raw.bottomBankAccountNumber as string) || null,
        bottomBankAccountName: (raw.bottomBankAccountName as string) || null,
        customAddressEnabled: Boolean(raw.customAddressEnabled),
        customAddress: (raw.customAddress as string) || null,
        footerLine1: (raw.footerLine1 as string) || null,
        footerLine1Bold: Boolean(raw.footerLine1Bold),
        footerLine2: (raw.footerLine2 as string) || null,
        footerLine2Bold: Boolean(raw.footerLine2Bold),
        printWifiEnabled: Boolean(raw.printWifiEnabled),
        wifiName: (raw.wifiName as string) || null,
        wifiPassword: (raw.wifiPassword as string) || null,
        paperSize: (raw.paperSize as 'K80' | 'K58') || 'K80',
        printersJson: (raw.printersJson as string) || null,
        templateConfigJson: (raw.templateConfigJson as string) || null,
        updatedAt: Number(raw.updatedAt ?? Date.now()),
      };
    }
    return {
      storeId,
      maxReceiptReprintCount: 0,
      paymentCopyCount: 1,
      allowProvisionalPrint: true,
      provisionalCopyCount: 1,
      logoHorizontalLayout: false,
      logoMediaId: null,
      bottomImageDescription: 'QR thanh toán',
      bottomImageType: 'UPLOAD',
      bottomImageMediaId: null,
      bottomBankName: null,
      bottomBankAccountNumber: null,
      bottomBankAccountName: null,
      customAddressEnabled: false,
      customAddress: null,
      footerLine1: 'Cảm ơn quý khách và hẹn gặp lại',
      footerLine1Bold: false,
      footerLine2: 'Một sản phẩm của Pro POS',
      footerLine2Bold: true,
      printWifiEnabled: false,
      wifiName: null,
      wifiPassword: null,
      paperSize: 'K80',
      printersJson: null,
      templateConfigJson: null,
      updatedAt: Date.now(),
    };
  }

  async updatePrintSettings(input: {
    storeId: string;
    maxReceiptReprintCount: number;
    paymentCopyCount: number;
    allowProvisionalPrint: boolean;
    provisionalCopyCount: number;
    logoHorizontalLayout: boolean;
    logoMediaId?: string | null;
    bottomImageDescription?: string | null;
    bottomImageType: string;
    bottomImageMediaId?: string | null;
    bottomBankName?: string | null;
    bottomBankAccountNumber?: string | null;
    bottomBankAccountName?: string | null;
    customAddressEnabled: boolean;
    customAddress?: string | null;
    footerLine1?: string | null;
    footerLine1Bold: boolean;
    footerLine2?: string | null;
    footerLine2Bold: boolean;
    printWifiEnabled: boolean;
    wifiName?: string | null;
    wifiPassword?: string | null;
    paperSize: string;
    printersJson?: string | null;
    templateConfigJson?: string | null;
    auditContext?: AuditContext;
  }) {
    const before = input.auditContext ? await this.getPrintSettings(input.storeId) : null;
    const now = Date.now();
    await this.repository.upsertPrintSettings({
      storeId: input.storeId,
      maxReceiptReprintCount: input.maxReceiptReprintCount,
      paymentCopyCount: input.paymentCopyCount,
      allowProvisionalPrint: input.allowProvisionalPrint,
      provisionalCopyCount: input.provisionalCopyCount,
      logoHorizontalLayout: input.logoHorizontalLayout,
      logoMediaId: input.logoMediaId ?? null,
      bottomImageDescription: input.bottomImageDescription ?? null,
      bottomImageType: input.bottomImageType,
      bottomImageMediaId: input.bottomImageMediaId ?? null,
      bottomBankName: input.bottomBankName ?? null,
      bottomBankAccountNumber: input.bottomBankAccountNumber ?? null,
      bottomBankAccountName: input.bottomBankAccountName ?? null,
      customAddressEnabled: input.customAddressEnabled,
      customAddress: input.customAddress ?? null,
      footerLine1: input.footerLine1 ?? null,
      footerLine1Bold: input.footerLine1Bold,
      footerLine2: input.footerLine2 ?? null,
      footerLine2Bold: input.footerLine2Bold,
      printWifiEnabled: input.printWifiEnabled,
      wifiName: input.wifiName ?? null,
      wifiPassword: input.wifiPassword ?? null,
      paperSize: input.paperSize,
      printersJson: input.printersJson ?? null,
      templateConfigJson: input.templateConfigJson ?? null,
      now,
    });
    if (input.auditContext) {
      const after = await this.getPrintSettings(input.storeId);
      await new AuditRepository(this.env.DB).record({
        storeId: input.storeId,
        context: input.auditContext,
        action: 'PRINT_SETTINGS_UPDATED',
        entityType: 'STORE_PRINT_SETTINGS',
        entityId: input.storeId,
        before,
        after,
        now,
      });
    }
    return { storeId: input.storeId, updated: true };
  }
}
