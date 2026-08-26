import type { BankAccountInput } from '@contracts/store';

export interface StoreBankAccountRow {
  id: string;
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  isDefault: 0 | 1;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: number;
  updatedAt: number;
}

export class StoreRepository {
  constructor(private readonly db: D1Database) {}

  getSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          s.id, s.name, s.status, s.timezone, ss.phone, ss.address,
          ss.currency, ss.business_day_cutoff_minutes AS businessDayCutoffMinutes,
          ss.bank_name AS bankName, ss.bank_account_number AS bankAccountNumber,
          ss.bank_account_name AS bankAccountName, ss.bank_qr_media_id AS bankQrMediaId,
          ss.province_code AS provinceCode, ss.province_name AS provinceName,
          ss.ward_code AS wardCode, ss.ward_name AS wardName,
          ss.location_verification_enabled AS locationVerificationEnabled,
          ss.latitude AS latitude, ss.longitude AS longitude,
          ss.allowed_radius_meters AS allowedRadiusMeters,
          ss.max_accuracy_meters AS maxAccuracyMeters
         FROM stores s JOIN store_settings ss ON ss.store_id = s.id
         WHERE s.id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first<{
        id: string;
        name: string;
        status: 'ACTIVE' | 'LOCKED';
        timezone: string;
        phone: string | null;
        address: string | null;
        currency: string;
        businessDayCutoffMinutes: number;
        bankName: string | null;
        bankAccountNumber: string | null;
        bankAccountName: string | null;
        bankQrMediaId: string | null;
        provinceCode: number | null;
        provinceName: string | null;
        wardCode: number | null;
        wardName: string | null;
        locationVerificationEnabled: number;
        latitude: number | null;
        longitude: number | null;
        allowedRadiusMeters: number;
        maxAccuracyMeters: number;
      }>();
  }

  listBankAccounts(storeId: string, includeArchived = false) {
    return this.db
      .prepare(
        `SELECT id, bank_bin AS bankBin, bank_code AS bankCode, bank_name AS bankName,
                account_number AS accountNumber, account_name AS accountName,
                is_default AS isDefault, status, created_at AS createdAt,
                updated_at AS updatedAt
         FROM store_bank_accounts
         WHERE store_id = ? AND (? = 1 OR status = 'ACTIVE')
         ORDER BY is_default DESC, created_at, id`,
      )
      .bind(storeId, includeArchived ? 1 : 0)
      .all<StoreBankAccountRow>();
  }

  findBankAccount(storeId: string, bankAccountId: string) {
    return this.db
      .prepare(
        `SELECT id, bank_bin AS bankBin, bank_code AS bankCode, bank_name AS bankName,
                account_number AS accountNumber, account_name AS accountName,
                is_default AS isDefault, status, created_at AS createdAt,
                updated_at AS updatedAt
         FROM store_bank_accounts WHERE store_id = ? AND id = ? LIMIT 1`,
      )
      .bind(storeId, bankAccountId)
      .first<StoreBankAccountRow>();
  }

  private mirrorDefaultBankAccountStatement(storeId: string, now: number) {
    return this.db
      .prepare(
        `UPDATE store_settings
         SET bank_name = (
               SELECT bank_bin FROM store_bank_accounts
               WHERE store_id = ? AND status = 'ACTIVE' AND is_default = 1 LIMIT 1
             ),
             bank_account_number = (
               SELECT account_number FROM store_bank_accounts
               WHERE store_id = ? AND status = 'ACTIVE' AND is_default = 1 LIMIT 1
             ),
             bank_account_name = (
               SELECT account_name FROM store_bank_accounts
               WHERE store_id = ? AND status = 'ACTIVE' AND is_default = 1 LIMIT 1
             ),
             bank_qr_media_id = NULL,
             updated_at = ?
         WHERE store_id = ?`,
      )
      .bind(storeId, storeId, storeId, now, storeId);
  }

  createBankAccount(input: {
    id: string;
    storeId: string;
    values: BankAccountInput;
    isDefault: boolean;
    now: number;
  }) {
    const statements: D1PreparedStatement[] = [];
    if (input.isDefault) {
      statements.push(
        this.db
          .prepare(
            `UPDATE store_bank_accounts SET is_default = 0, updated_at = ?
             WHERE store_id = ? AND status = 'ACTIVE' AND is_default = 1`,
          )
          .bind(input.now, input.storeId),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO store_bank_accounts (
             id, store_id, bank_bin, bank_code, bank_name, account_number,
             account_name, is_default, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        )
        .bind(
          input.id,
          input.storeId,
          input.values.bankBin,
          input.values.bankCode,
          input.values.bankName,
          input.values.accountNumber,
          input.values.accountName,
          input.isDefault ? 1 : 0,
          input.now,
          input.now,
        ),
    );
    if (input.isDefault)
      statements.push(this.mirrorDefaultBankAccountStatement(input.storeId, input.now));
    return this.db.batch(statements);
  }

  updateBankAccount(input: {
    id: string;
    storeId: string;
    values: BankAccountInput;
    isDefault: boolean;
    mirrorLegacy: boolean;
    now: number;
  }) {
    const statements: D1PreparedStatement[] = [];
    if (input.isDefault) {
      statements.push(
        this.db
          .prepare(
            `UPDATE store_bank_accounts SET is_default = 0, updated_at = ?
             WHERE store_id = ? AND status = 'ACTIVE' AND is_default = 1 AND id <> ?`,
          )
          .bind(input.now, input.storeId, input.id),
      );
    }
    statements.push(
      this.db
        .prepare(
          `UPDATE store_bank_accounts
           SET bank_bin = ?, bank_code = ?, bank_name = ?, account_number = ?,
               account_name = ?, is_default = ?, updated_at = ?
           WHERE store_id = ? AND id = ? AND status = 'ACTIVE'`,
        )
        .bind(
          input.values.bankBin,
          input.values.bankCode,
          input.values.bankName,
          input.values.accountNumber,
          input.values.accountName,
          input.isDefault ? 1 : 0,
          input.now,
          input.storeId,
          input.id,
        ),
    );
    if (input.mirrorLegacy) {
      statements.push(this.mirrorDefaultBankAccountStatement(input.storeId, input.now));
    }
    return this.db.batch(statements);
  }

  archiveBankAccount(input: { id: string; storeId: string; wasDefault: boolean; now: number }) {
    const statements: D1PreparedStatement[] = [
      this.db
        .prepare(
          `UPDATE store_bank_accounts
           SET status = 'ARCHIVED', is_default = 0, archived_at = ?, updated_at = ?
           WHERE store_id = ? AND id = ? AND status = 'ACTIVE'`,
        )
        .bind(input.now, input.now, input.storeId, input.id),
    ];
    if (input.wasDefault) {
      statements.push(this.mirrorDefaultBankAccountStatement(input.storeId, input.now));
    }
    return this.db.batch(statements);
  }

  findActiveBankQrMedia(storeId: string, mediaId: string) {
    return this.db
      .prepare(
        `SELECT id, mime_type AS mimeType FROM media_objects
         WHERE id = ? AND store_id = ? AND status = 'ACTIVE'
           AND mime_type IN ('image/png', 'image/jpeg', 'image/webp')
         LIMIT 1`,
      )
      .bind(mediaId, storeId)
      .first();
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
    now: number;
  }) {
    return this.db.batch([
      this.db
        .prepare('UPDATE stores SET name = ?, updated_at = ? WHERE id = ?')
        .bind(input.name, input.now, input.storeId),
      this.db
        .prepare(
          `UPDATE store_settings
           SET phone = ?, address = ?, business_day_cutoff_minutes = ?,
               bank_name = ?, bank_account_number = ?, bank_account_name = ?,
               bank_qr_media_id = ?, province_code = ?, province_name = ?,
               ward_code = ?, ward_name = ?,
               updated_at = ?
           WHERE store_id = ?`,
        )
        .bind(
          input.phone,
          input.address,
          input.cutoff,
          input.bankName,
          input.bankAccountNumber,
          input.bankAccountName,
          input.bankQrMediaId,
          input.provinceCode,
          input.provinceName,
          input.wardCode,
          input.wardName,
          input.now,
          input.storeId,
        ),
    ]);
  }

  updateLocationSettings(input: {
    storeId: string;
    locationVerificationEnabled: boolean;
    latitude: number | null;
    longitude: number | null;
    allowedRadiusMeters: number;
    maxAccuracyMeters: number;
    now: number;
  }) {
    return this.db
      .prepare(
        `UPDATE store_settings SET location_verification_enabled = ?, latitude = ?, longitude = ?,
           allowed_radius_meters = ?, max_accuracy_meters = ?, updated_at = ?
         WHERE store_id = ?`,
      )
      .bind(
        input.locationVerificationEnabled ? 1 : 0,
        input.latitude,
        input.longitude,
        input.allowedRadiusMeters,
        input.maxAccuracyMeters,
        input.now,
        input.storeId,
      )
      .run();
  }

  async listAuditLogs(storeId: string, limit: number) {
    return this.db
      .prepare(
        `SELECT
          al.id, al.action, al.entity_type AS entityType, al.entity_id AS entityId,
          al.request_id AS requestId, al.before_json AS beforeJson,
          al.after_json AS afterJson, al.created_at AS createdAt,
          u.display_name AS actorName, d.name AS deviceName
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_user_id
         LEFT JOIN devices d ON d.id = al.device_id
         WHERE al.store_id = ? ORDER BY al.created_at DESC LIMIT ?`,
      )
      .bind(storeId, limit)
      .all();
  }

  getPrintSettings(storeId: string) {
    return this.db
      .prepare(
        `SELECT
          store_id AS storeId,
          max_receipt_reprint_count AS maxReceiptReprintCount,
          payment_copy_count AS paymentCopyCount,
          allow_provisional_print = 1 AS allowProvisionalPrint,
          provisional_copy_count AS provisionalCopyCount,
          logo_horizontal_layout = 1 AS logoHorizontalLayout,
          logo_media_id AS logoMediaId,
          bottom_image_description AS bottomImageDescription,
          bottom_image_type AS bottomImageType,
          bottom_image_media_id AS bottomImageMediaId,
          bottom_bank_name AS bottomBankName,
          bottom_bank_account_number AS bottomBankAccountNumber,
          bottom_bank_account_name AS bottomBankAccountName,
          custom_address_enabled = 1 AS customAddressEnabled,
          custom_address AS customAddress,
          footer_line_1 AS footerLine1,
          footer_line_1_bold = 1 AS footerLine1Bold,
          footer_line_2 AS footerLine2,
          footer_line_2_bold = 1 AS footerLine2Bold,
          print_wifi_enabled = 1 AS printWifiEnabled,
          wifi_name AS wifiName,
          wifi_password AS wifiPassword,
          paper_size AS paperSize,
          printers_json AS printersJson,
          template_config_json AS templateConfigJson,
          updated_at AS updatedAt
        FROM store_print_settings
        WHERE store_id = ? LIMIT 1`,
      )
      .bind(storeId)
      .first();
  }

  async upsertPrintSettings(input: {
    storeId: string;
    maxReceiptReprintCount: number;
    paymentCopyCount: number;
    allowProvisionalPrint: boolean;
    provisionalCopyCount: number;
    logoHorizontalLayout: boolean;
    logoMediaId: string | null;
    bottomImageDescription: string | null;
    bottomImageType: string;
    bottomImageMediaId: string | null;
    bottomBankName: string | null;
    bottomBankAccountNumber: string | null;
    bottomBankAccountName: string | null;
    customAddressEnabled: boolean;
    customAddress: string | null;
    footerLine1: string | null;
    footerLine1Bold: boolean;
    footerLine2: string | null;
    footerLine2Bold: boolean;
    printWifiEnabled: boolean;
    wifiName: string | null;
    wifiPassword: string | null;
    paperSize: string;
    printersJson: string | null;
    templateConfigJson: string | null;
    now: number;
  }) {
    return this.db
      .prepare(
        `INSERT INTO store_print_settings (
          store_id, max_receipt_reprint_count, payment_copy_count,
          allow_provisional_print, provisional_copy_count, logo_horizontal_layout,
          logo_media_id, bottom_image_description, bottom_image_type,
          bottom_image_media_id, bottom_bank_name, bottom_bank_account_number,
          bottom_bank_account_name, custom_address_enabled, custom_address,
          footer_line_1, footer_line_1_bold, footer_line_2, footer_line_2_bold,
          print_wifi_enabled, wifi_name, wifi_password, paper_size, printers_json,
          template_config_json, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(store_id) DO UPDATE SET
          max_receipt_reprint_count = excluded.max_receipt_reprint_count,
          payment_copy_count = excluded.payment_copy_count,
          allow_provisional_print = excluded.allow_provisional_print,
          provisional_copy_count = excluded.provisional_copy_count,
          logo_horizontal_layout = excluded.logo_horizontal_layout,
          logo_media_id = excluded.logo_media_id,
          bottom_image_description = excluded.bottom_image_description,
          bottom_image_type = excluded.bottom_image_type,
          bottom_image_media_id = excluded.bottom_image_media_id,
          bottom_bank_name = excluded.bottom_bank_name,
          bottom_bank_account_number = excluded.bottom_bank_account_number,
          bottom_bank_account_name = excluded.bottom_bank_account_name,
          custom_address_enabled = excluded.custom_address_enabled,
          custom_address = excluded.custom_address,
          footer_line_1 = excluded.footer_line_1,
          footer_line_1_bold = excluded.footer_line_1_bold,
          footer_line_2 = excluded.footer_line_2,
          footer_line_2_bold = excluded.footer_line_2_bold,
          print_wifi_enabled = excluded.print_wifi_enabled,
          wifi_name = excluded.wifi_name,
          wifi_password = excluded.wifi_password,
          paper_size = excluded.paper_size,
          printers_json = excluded.printers_json,
          template_config_json = excluded.template_config_json,
          updated_at = excluded.updated_at`,
      )
      .bind(
        input.storeId,
        input.maxReceiptReprintCount,
        input.paymentCopyCount,
        input.allowProvisionalPrint ? 1 : 0,
        input.provisionalCopyCount,
        input.logoHorizontalLayout ? 1 : 0,
        input.logoMediaId,
        input.bottomImageDescription,
        input.bottomImageType,
        input.bottomImageMediaId,
        input.bottomBankName,
        input.bottomBankAccountNumber,
        input.bottomBankAccountName,
        input.customAddressEnabled ? 1 : 0,
        input.customAddress,
        input.footerLine1,
        input.footerLine1Bold ? 1 : 0,
        input.footerLine2,
        input.footerLine2Bold ? 1 : 0,
        input.printWifiEnabled ? 1 : 0,
        input.wifiName,
        input.wifiPassword,
        input.paperSize,
        input.printersJson,
        input.templateConfigJson,
        input.now,
      )
      .run();
  }
}
