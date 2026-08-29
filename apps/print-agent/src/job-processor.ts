import { AgentApiClient } from './api-client';
import type { PrintAgentConfig } from './config';
import { AgentTcpTransport } from './tcp-transport';
import { pngBytesToEscPosRaster } from './png-raster';
import {
  buildPrintDataFromDebtPayment,
  buildPrintDataFromInvoice,
  buildPrintDataFromQuote,
  type PosReceiptPrintData,
} from '@domain/receipt/receipt-generator';
import { buildEscPosTextReceipt } from '@printing/escpos/escpos-text-builder';
import { createReceiptDocument } from '@domain/receipt/receipt-document';
import type { PrintJob } from '@contracts/print-job';
import { parsePrinterDeviceConfig, type StorePrintSettings } from '@contracts/store';
import { PrinterError, type PrinterFailureStage } from '@printing/printer-errors';

type PrintDocumentApi = Pick<AgentApiClient, 'get'>;

/**
 * WPC1258 relies on combining accent bytes that many ESC/POS-compatible printers
 * advertise but render as stray symbols. Keep the agent output deterministic on
 * those devices; UTF-8 remains available when the printer explicitly supports it.
 */
export function resolveAgentVietnameseMode(
  mode: 'WPC1258' | 'UNACCENTED' | 'UTF8',
): 'UNACCENTED' | 'UTF8' {
  return mode === 'UTF8' ? 'UTF8' : 'UNACCENTED';
}

export class PrintJobProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions & { failureStage?: PrinterFailureStage; retryable?: boolean },
  ) {
    super(message, options);
    this.name = 'PrintJobProcessingError';
    this.failureStage = options?.failureStage ?? 'BEFORE_WRITE';
    this.retryable = options?.retryable ?? this.failureStage === 'BEFORE_WRITE';
  }

  readonly failureStage: PrinterFailureStage;
  readonly retryable: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads exactly the declared document. Cross-type fallbacks can print the wrong legal document. */
export async function loadPrintDataForJob(
  apiClient: PrintDocumentApi,
  job: Pick<PrintJob, 'documentType' | 'documentId'>,
): Promise<PosReceiptPrintData> {
  const documentType: string = job.documentType;
  switch (documentType) {
    case 'invoice': {
      try {
        const invoice = await apiClient.get<unknown>(`/api/v1/pos/invoices/${job.documentId}`);
        const data = buildPrintDataFromInvoice(invoice);
        if (data.receiptType !== 'PAYMENT') {
          throw new Error('Invoice renderer không tạo PAYMENT receipt.');
        }
        return data;
      } catch (error) {
        throw new PrintJobProcessingError(
          'INVOICE_FETCH_FAILED',
          `Không thể nạp invoice ${job.documentId}: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    }
    case 'provisional': {
      try {
        const quote = await apiClient.get<unknown>(`/api/v1/pos/orders/${job.documentId}/quote`);
        return buildPrintDataFromQuote(quote, 'PROVISIONAL');
      } catch (error) {
        throw new PrintJobProcessingError(
          'ORDER_FETCH_FAILED',
          `Không thể nạp đơn tạm tính ${job.documentId}: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    }
    case 'debt_payment': {
      try {
        const payment = await apiClient.get<unknown>(`/api/v1/pos/debt-payments/${job.documentId}`);
        return buildPrintDataFromDebtPayment(payment);
      } catch (error) {
        throw new PrintJobProcessingError(
          'DEBT_PAYMENT_FETCH_FAILED',
          `Không thể nạp phiếu thu công nợ ${job.documentId}: ${errorMessage(error)}`,
          { cause: error },
        );
      }
    }
    default:
      throw new PrintJobProcessingError(
        'INVALID_DOCUMENT_TYPE',
        `Loại tài liệu in không hợp lệ: ${documentType}`,
      );
  }
}

interface PrintStoreContext {
  storeName?: string | null;
  storeAddress?: string | null;
  storePhone?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountName?: string | null;
  store?: {
    name?: string | null;
    address?: string | null;
    phone?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankAccountName?: string | null;
  };
}

interface AgentPrintTransport {
  send(data: Uint8Array, options: { host: string; port?: number }): Promise<void>;
}

export class JobProcessor {
  private readonly inFlight = new Set<string>();
  private readonly rasterCache = new Map<string, Uint8Array>();

  constructor(
    private readonly config: PrintAgentConfig,
    private readonly apiClient: AgentApiClient,
    private readonly transport: AgentPrintTransport = new AgentTcpTransport(),
  ) {}

  private async loadOptionalRaster(
    mediaId: string | null | undefined,
    maximumWidthDots: number,
    maximumHeightDots: number,
    label: string,
  ): Promise<Uint8Array | null> {
    if (!mediaId) return null;
    const cacheKey = `media:${mediaId}:${maximumWidthDots}x${maximumHeightDots}`;
    const cached = this.rasterCache.get(cacheKey);
    if (cached) return cached;
    try {
      const media = await this.apiClient.getBytes(`/api/v1/pos/print-media/${mediaId}`);
      if (media.contentType && !media.contentType.includes('png')) {
        throw new Error(`định dạng ${media.contentType} chưa được hỗ trợ; hãy tải PNG`);
      }
      const raster = pngBytesToEscPosRaster(media.bytes, maximumWidthDots, maximumHeightDots);
      if (this.rasterCache.size >= 32) {
        const oldestKey = this.rasterCache.keys().next().value as string | undefined;
        if (oldestKey) this.rasterCache.delete(oldestKey);
      }
      this.rasterCache.set(cacheKey, raster);
      return raster;
    } catch (error) {
      console.warn(`[PrintAgent] Bỏ qua ${label} optional ${mediaId}: ${errorMessage(error)}`);
      return null;
    }
  }

  private async loadOptionalVietQrRaster(
    url: string | null,
    maximumWidthDots: number,
  ): Promise<Uint8Array | null> {
    if (!url) return null;
    const cacheKey = `vietqr:${url}`;
    const cached = this.rasterCache.get(cacheKey);
    if (cached) return cached;
    try {
      const raster = pngBytesToEscPosRaster(
        await this.apiClient.getPublicPng(url),
        maximumWidthDots,
        500,
      );
      if (this.rasterCache.size >= 32) {
        const oldestKey = this.rasterCache.keys().next().value as string | undefined;
        if (oldestKey) this.rasterCache.delete(oldestKey);
      }
      this.rasterCache.set(cacheKey, raster);
      return raster;
    } catch (error) {
      console.warn(`[PrintAgent] Bỏ qua VietQR optional: ${errorMessage(error)}`);
      return null;
    }
  }

  async processJob(job: PrintJob): Promise<boolean> {
    if (this.inFlight.has(job.id)) return false;
    this.inFlight.add(job.id);
    let claimed = false;

    try {
      console.log(
        `\n[PrintAgent] Nhận print job mới: ${job.id} (${job.documentType}:${job.documentId})`,
      );

      try {
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/claim`, {
          claimedByDeviceId: this.config.agentId || 'print-agent',
        });
        claimed = true;
      } catch (error) {
        console.warn(
          `[PrintAgent] Không thể claim job ${job.id} (có thể đã được claim bởi agent khác):`,
          error,
        );
        return false;
      }

      try {
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/start`, {});
      } catch (error) {
        throw new PrintJobProcessingError(
          'PRINT_JOB_START_FAILED',
          `Không thể bắt đầu print job: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      let context: PrintStoreContext | null;
      try {
        context = await this.apiClient.get<PrintStoreContext>('/api/v1/pos/context');
      } catch (error) {
        throw new PrintJobProcessingError(
          'STORE_CONTEXT_FETCH_FAILED',
          `Không thể nạp thông tin cửa hàng: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      let printSettings: StorePrintSettings;
      try {
        printSettings = await this.apiClient.get<StorePrintSettings>('/api/v1/pos/print-settings');
      } catch (error) {
        throw new PrintJobProcessingError(
          'PRINT_SETTINGS_FETCH_FAILED',
          `Không thể nạp cấu hình in Owner: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      const printData = await loadPrintDataForJob(this.apiClient, job);
      const safeContext = context ?? {};
      if (!context) {
        console.warn(
          '[PrintAgent] Server không trả store context; dùng thông tin cục bộ nếu có và bỏ trống field còn thiếu.',
        );
      }
      const storeInfo = {
        name: (
          safeContext.storeName ||
          safeContext.store?.name ||
          this.config.storeName ||
          ''
        ).trim(),
        address: safeContext.storeAddress || safeContext.store?.address || undefined,
        phone: safeContext.storePhone || safeContext.store?.phone || undefined,
        bankName: safeContext.bankName ?? safeContext.store?.bankName ?? null,
        bankAccountNumber:
          safeContext.bankAccountNumber ?? safeContext.store?.bankAccountNumber ?? null,
        bankAccountName: safeContext.bankAccountName ?? safeContext.store?.bankAccountName ?? null,
      };
      if (!storeInfo.name) {
        console.warn('[PrintAgent] Cửa hàng chưa cấu hình tên; receipt sẽ không chèn branding.');
      }

      const printerConfig = parsePrinterDeviceConfig(printSettings.printersJson);
      const paperSize =
        printSettings.paperSize || printerConfig.paperSize || this.config.paperSize || 'K80';
      const autoCut = printerConfig.autoCut ?? this.config.autoCut ?? true;
      const openCashDrawer = printerConfig.openCashDrawer ?? this.config.openCashDrawer ?? false;
      const copyCount = Math.max(
        1,
        printData.receiptType === 'PROVISIONAL'
          ? (printSettings.provisionalCopyCount ?? 1)
          : (printSettings.paymentCopyCount ?? 1),
      );
      const receiptDocument = createReceiptDocument({
        data: printData,
        printSettings,
        storeInfo: {
          storeName: storeInfo.name,
          address: storeInfo.address,
          phone: storeInfo.phone,
          bankName: storeInfo.bankName,
          bankAccountNumber: storeInfo.bankAccountNumber,
          bankAccountName: storeInfo.bankAccountName,
        },
      });
      const maximumDots = receiptDocument.profile.defaultPrintableDots;
      const horizontalLogo = Boolean(
        printSettings.logoHorizontalLayout && receiptDocument.media.logoUrl,
      );
      const [logoRasterBytes, bottomRasterBytes] = await Promise.all([
        receiptDocument.media.logoUrl
          ? this.loadOptionalRaster(
              printSettings.logoMediaId,
              Math.round(
                maximumDots * (horizontalLogo ? (receiptDocument.isK58 ? 0.24 : 0.22) : 0.6),
              ),
              horizontalLogo ? (receiptDocument.isK58 ? 72 : 96) : 180,
              'logo',
            )
          : null,
        printSettings.bottomImageType === 'UPLOAD' && receiptDocument.media.bottomImageUrl
          ? this.loadOptionalRaster(
              printSettings.bottomImageMediaId,
              maximumDots,
              500,
              'bottom image',
            )
          : receiptDocument.media.vietQrPayload
            ? null
            : this.loadOptionalVietQrRaster(receiptDocument.media.bottomImageUrl, maximumDots),
      ]);

      let escposBytes: Uint8Array;
      try {
        const copies: Uint8Array[] = [];
        for (let copyIndex = 1; copyIndex <= copyCount; copyIndex += 1) {
          copies.push(
            buildEscPosTextReceipt(printData, {
              paperSize,
              autoCut,
              openCashDrawer:
                openCashDrawer && printData.receiptType === 'PAYMENT' && copyIndex === 1,
              storeName: storeInfo.name,
              storeAddress: storeInfo.address,
              storePhone: storeInfo.phone,
              printSettings,
              storeInfo: {
                storeName: storeInfo.name,
                address: storeInfo.address,
                phone: storeInfo.phone,
                bankName: storeInfo.bankName,
                bankAccountNumber: storeInfo.bankAccountNumber,
                bankAccountName: storeInfo.bankAccountName,
              },
              copy: { index: copyIndex, total: copyCount },
              vietnameseMode: resolveAgentVietnameseMode(printerConfig.vietnameseMode),
              logoRasterBytes,
              bottomRasterBytes,
            }),
          );
        }
        const totalLength = copies.reduce((sum, bytes) => sum + bytes.length, 0);
        escposBytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const bytes of copies) {
          escposBytes.set(bytes, offset);
          offset += bytes.length;
        }
      } catch (error) {
        throw new PrintJobProcessingError(
          'RECEIPT_RENDER_FAILED',
          `Không thể render receipt: ${errorMessage(error)}`,
          { cause: error },
        );
      }

      const printerIp = printerConfig.networkIp || this.config.printerIp || '';
      const printerPort = printerConfig.networkPort || this.config.printerPort || 9100;
      console.log(
        `[PrintAgent] Đang gửi ${copyCount} liên tới máy in LAN ${printerIp}:${printerPort}...`,
      );
      try {
        await this.transport.send(escposBytes, { host: printerIp, port: printerPort });
      } catch (error) {
        const message = errorMessage(error);
        const printerError = error instanceof PrinterError ? error : null;
        const failureStage = printerError?.failureStage ?? 'BEFORE_WRITE';
        const code =
          printerError?.code ??
          (/connect|kết nối|ECONN|timeout/i.test(message)
            ? 'NETWORK_PRINTER_UNREACHABLE'
            : 'SOCKET_WRITE_ERROR');
        throw new PrintJobProcessingError(
          code,
          message,
          { cause: error, failureStage, retryable: failureStage === 'BEFORE_WRITE' },
        );
      }

      await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/complete`, {});
      console.log(
        `\x1b[32m✔ [PrintAgent] In thành công job ${job.id} (${printData.orderCode || job.documentId})\x1b[0m`,
      );
      return true;
    } catch (error) {
      const processingError =
        error instanceof PrintJobProcessingError
          ? error
          : new PrintJobProcessingError('PRINT_FAILED', errorMessage(error), { cause: error });
      console.error(
        `\x1b[31m✘ [PrintAgent] In thất bại cho job ${job.id}:\x1b[0m`,
        processingError.message,
      );
      if (claimed) {
        try {
          const endpoint =
            processingError.failureStage === 'DURING_WRITE' ? 'uncertain' : 'fail';
          await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/${endpoint}`, {
            failureCode: processingError.code,
            failureMessage: processingError.message,
          });
        } catch (failError) {
          console.error('[PrintAgent] Không thể cập nhật trạng thái print job:', failError);
        }
      }
      return false;
    } finally {
      this.inFlight.delete(job.id);
    }
  }
}
