import { AppError } from '@server/lib/app-error';
import { StoreRepository } from '@server/repositories/store-repository';
import { AuditRepository, type AuditContext } from '@server/repositories/audit-repository';
import type { BankAccountDto, BankAccountInput, StorePrintSettings } from '@contracts/store';

export class StoreService {
  private readonly repository: StoreRepository;

  constructor(private readonly env: CloudflareBindings) {
    this.repository = new StoreRepository(env.DB);
  }

  private bankAccountDto(
    row: Awaited<ReturnType<StoreRepository['findBankAccount']>>,
  ): BankAccountDto | null {
    if (!row) return null;
    return {
      ...row,
      isDefault: row.isDefault === 1,
    };
  }

  async listBankAccounts(storeId: string): Promise<BankAccountDto[]> {
    const result = await this.repository.listBankAccounts(storeId);
    return result.results.map((row) => Object.assign({}, row, { isDefault: row.isDefault === 1 }));
  }

  async getSettings(storeId: string) {
    const [settings, bankAccounts] = await Promise.all([
      this.repository.getSettings(storeId),
      this.listBankAccounts(storeId),
    ]);
    return settings ? { ...settings, bankAccounts } : settings;
  }

  private mapBankAccountMutationError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('uq_store_bank_accounts_active_identity') ||
      message.includes(
        'store_bank_accounts.store_id, store_bank_accounts.bank_bin, store_bank_accounts.account_number',
      )
    ) {
      throw new AppError('BANK_ACCOUNT_DUPLICATE', 'Tài khoản ngân hàng này đã tồn tại.', 409);
    }
    if (
      message.includes('uq_store_bank_accounts_default') ||
      message.includes('UNIQUE constraint failed: store_bank_accounts.store_id')
    ) {
      throw new AppError(
        'BANK_ACCOUNT_DEFAULT_CONFLICT',
        'Tài khoản mặc định đã thay đổi. Vui lòng tải lại.',
        409,
      );
    }
    throw error;
  }

  async createBankAccount(input: {
    storeId: string;
    values: BankAccountInput;
    auditContext: AuditContext;
  }) {
    const active = await this.listBankAccounts(input.storeId);
    const id = crypto.randomUUID();
    const now = Date.now();
    try {
      await this.repository.createBankAccount({
        id,
        storeId: input.storeId,
        values: input.values,
        isDefault: active.length === 0 || input.values.isDefault,
        now,
      });
    } catch (error) {
      this.mapBankAccountMutationError(error);
    }
    const after = this.bankAccountDto(await this.repository.findBankAccount(input.storeId, id));
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'STORE_BANK_ACCOUNT_CREATED',
      entityType: 'STORE_BANK_ACCOUNT',
      entityId: id,
      before: null,
      after,
      now,
    });
    return { bankAccount: after!, bankAccounts: await this.listBankAccounts(input.storeId) };
  }

  async updateBankAccount(input: {
    storeId: string;
    bankAccountId: string;
    values: BankAccountInput;
    auditContext: AuditContext;
  }) {
    const beforeRow = await this.repository.findBankAccount(input.storeId, input.bankAccountId);
    if (!beforeRow || beforeRow.status !== 'ACTIVE') {
      throw new AppError('BANK_ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản ngân hàng.', 404);
    }
    if (beforeRow.isDefault === 1 && !input.values.isDefault) {
      throw new AppError(
        'BANK_ACCOUNT_DEFAULT_REQUIRED',
        'Hãy đặt một tài khoản khác làm mặc định trước.',
        422,
      );
    }
    const now = Date.now();
    try {
      await this.repository.updateBankAccount({
        id: input.bankAccountId,
        storeId: input.storeId,
        values: input.values,
        isDefault: input.values.isDefault,
        mirrorLegacy: input.values.isDefault || beforeRow.isDefault === 1,
        now,
      });
    } catch (error) {
      this.mapBankAccountMutationError(error);
    }
    const before = this.bankAccountDto(beforeRow);
    const after = this.bankAccountDto(
      await this.repository.findBankAccount(input.storeId, input.bankAccountId),
    );
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'STORE_BANK_ACCOUNT_UPDATED',
      entityType: 'STORE_BANK_ACCOUNT',
      entityId: input.bankAccountId,
      before,
      after,
      now,
    });
    return { bankAccount: after!, bankAccounts: await this.listBankAccounts(input.storeId) };
  }

  async archiveBankAccount(input: {
    storeId: string;
    bankAccountId: string;
    auditContext: AuditContext;
  }) {
    const [beforeRow, active] = await Promise.all([
      this.repository.findBankAccount(input.storeId, input.bankAccountId),
      this.listBankAccounts(input.storeId),
    ]);
    if (!beforeRow || beforeRow.status !== 'ACTIVE') {
      throw new AppError('BANK_ACCOUNT_NOT_FOUND', 'Không tìm thấy tài khoản ngân hàng.', 404);
    }
    if (beforeRow.isDefault === 1 && active.length > 1) {
      throw new AppError(
        'BANK_ACCOUNT_DEFAULT_DELETE_BLOCKED',
        'Hãy đặt một tài khoản khác làm mặc định trước khi xóa.',
        422,
      );
    }
    const now = Date.now();
    await this.repository.archiveBankAccount({
      id: input.bankAccountId,
      storeId: input.storeId,
      wasDefault: beforeRow.isDefault === 1,
      now,
    });
    const before = this.bankAccountDto(beforeRow);
    const after = this.bankAccountDto(
      await this.repository.findBankAccount(input.storeId, input.bankAccountId),
    );
    await new AuditRepository(this.env.DB).record({
      storeId: input.storeId,
      context: input.auditContext,
      action: 'STORE_BANK_ACCOUNT_ARCHIVED',
      entityType: 'STORE_BANK_ACCOUNT',
      entityId: input.bankAccountId,
      before,
      after,
      now,
    });
    return { bankAccounts: await this.listBankAccounts(input.storeId) };
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
    locationVerificationEnabled?: boolean;
    latitude?: number | null;
    longitude?: number | null;
    allowedRadiusMeters?: number;
    maxAccuracyMeters?: number;
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
    await this.repository.updateSettings({
      ...input,
      now,
    });
    if (input.locationVerificationEnabled !== undefined) {
      await this.repository.updateLocationSettings({
        storeId: input.storeId,
        locationVerificationEnabled: input.locationVerificationEnabled,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        allowedRadiusMeters: input.allowedRadiusMeters ?? 300,
        maxAccuracyMeters: input.maxAccuracyMeters ?? 100,
        now,
      });
    }
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

  async getPrintSettings(storeId: string): Promise<StorePrintSettings> {
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
      footerLine2: 'Một sản phẩm của Văn Hậu IT',
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
    logoMediaId?: string | null | undefined;
    bottomImageDescription?: string | null | undefined;
    bottomImageType: string;
    bottomImageMediaId?: string | null | undefined;
    bottomBankName?: string | null | undefined;
    bottomBankAccountNumber?: string | null | undefined;
    bottomBankAccountName?: string | null | undefined;
    customAddressEnabled: boolean;
    customAddress?: string | null | undefined;
    footerLine1?: string | null | undefined;
    footerLine1Bold: boolean;
    footerLine2?: string | null | undefined;
    footerLine2Bold: boolean;
    printWifiEnabled: boolean;
    wifiName?: string | null | undefined;
    wifiPassword?: string | null | undefined;
    paperSize: string;
    printersJson?: string | null | undefined;
    templateConfigJson?: string | null | undefined;
    auditContext?: AuditContext | undefined;
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
