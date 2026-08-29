import { AgentApiClient } from './api-client';
import type { PrintAgentConfig } from './config';
import { AgentTcpTransport } from './tcp-transport';
import {
  buildPrintDataFromInvoice,
  buildPrintDataFromQuote,
  type PosReceiptPrintData,
} from '@domain/receipt/receipt-generator';
import { buildEscPosTextReceipt } from '@printing/escpos/escpos-text-builder';
import type { PrintJob } from '@contracts/print-job';
import type { StorePrintSettings } from '@contracts/store';

export class JobProcessor {
  private readonly inFlight = new Set<string>();
  private readonly transport = new AgentTcpTransport();

  constructor(
    private readonly config: PrintAgentConfig,
    private readonly apiClient: AgentApiClient,
  ) {}

  async processJob(job: PrintJob): Promise<boolean> {
    if (this.inFlight.has(job.id)) {
      return false;
    }
    this.inFlight.add(job.id);

    try {
      console.log(
        `\n[PrintAgent] Nhận print job mới: ${job.id} (${job.documentType}:${job.documentId})`,
      );

      // 1. Atomic Claim
      try {
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/claim`, {
          claimedByDeviceId: this.config.agentId || 'print-agent',
        });
      } catch (err) {
        console.warn(
          `[PrintAgent] Không thể claim job ${job.id} (có thể đã được claim bởi agent khác):`,
          err,
        );
        return false;
      }

      // 2. Fetch Document Data & Print Settings
      await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/start`, {});

      let printData: PosReceiptPrintData | null = null;
      let printSettings: StorePrintSettings | null = null;
      let storeInfo: {
        name: string;
        address?: string;
        phone?: string;
        bankName?: string | null;
        bankAccountNumber?: string | null;
        bankAccountName?: string | null;
      } = {
        name: this.config.storeName || 'PRO POS',
      };

      try {
        const [contextRes, settingsRes] = await Promise.all([
          this.apiClient.get<any>('/api/v1/pos/context').catch(() => null),
          this.apiClient.get<StorePrintSettings>('/api/v1/pos/print-settings').catch(() => null),
        ]);

        if (contextRes) {
          storeInfo = {
            name: contextRes.storeName || contextRes.store?.name || storeInfo.name,
            address: contextRes.storeAddress || contextRes.store?.address || undefined,
            phone: contextRes.storePhone || contextRes.store?.phone || undefined,
            bankName: contextRes.bankName ?? contextRes.store?.bankName ?? null,
            bankAccountNumber:
              contextRes.bankAccountNumber ?? contextRes.store?.bankAccountNumber ?? null,
            bankAccountName:
              contextRes.bankAccountName ?? contextRes.store?.bankAccountName ?? null,
          };
        }
        if (settingsRes) {
          printSettings = settingsRes;
        }

        if (job.documentType === 'invoice') {
          try {
            const invoice = await this.apiClient.get<any>(`/api/v1/pos/invoices/${job.documentId}`);
            printData = buildPrintDataFromInvoice(invoice);
          } catch {
            // Fallback: if documentId was order ID, fetch quote and format as PAYMENT
            const orderDoc = await this.apiClient.get<any>(
              `/api/v1/pos/orders/${job.documentId}/quote`,
            );
            printData = buildPrintDataFromQuote(orderDoc, 'PAYMENT');
          }
        } else {
          const quote = await this.apiClient.get<any>(`/api/v1/pos/orders/${job.documentId}/quote`);
          printData = buildPrintDataFromQuote(quote, 'PROVISIONAL');
        }
      } catch (err: any) {
        console.error(`[PrintAgent] Lỗi khi nạp dữ liệu hóa đơn:`, err);
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/fail`, {
          failureCode: 'FETCH_DOC_FAILED',
          failureMessage: `Không thể nạp dữ liệu ${job.documentType}: ${err.message}`,
        });
        return false;
      }

      if (!printData) {
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/fail`, {
          failureCode: 'DOCUMENT_EMPTY',
          failureMessage: 'Dữ liệu hóa đơn trống.',
        });
        return false;
      }

      // 3. Render ESC/POS Bytes
      let paperSize: 'K80' | 'K58' = this.config.paperSize || 'K80';
      let autoCut = this.config.autoCut ?? true;
      let openCashDrawer = this.config.openCashDrawer ?? false;

      if (printSettings?.printersJson) {
        try {
          const parsed = JSON.parse(printSettings.printersJson);
          if (parsed.paperSize) paperSize = parsed.paperSize;
          if (parsed.autoCut !== undefined) autoCut = parsed.autoCut;
          if (parsed.openCashDrawer !== undefined) openCashDrawer = parsed.openCashDrawer;
        } catch {
          // ignore
        }
      }

      const copyCount = Math.max(
        1,
        printData.receiptType === 'PROVISIONAL'
          ? (printSettings?.provisionalCopyCount ?? 1)
          : (printSettings?.paymentCopyCount ?? 1),
      );

      const copyByteArrays: Uint8Array[] = [];
      for (let cIdx = 1; cIdx <= copyCount; cIdx++) {
        const singleCopyBytes = buildEscPosTextReceipt(printData, {
          paperSize,
          autoCut,
          openCashDrawer: openCashDrawer && printData.receiptType === 'PAYMENT' && cIdx === 1,
          storeName: storeInfo.name,
          storeAddress: storeInfo.address,
          storePhone: storeInfo.phone,
          printSettings,
          storeInfo: {
            storeName: storeInfo.name,
            address: storeInfo.address,
            phone: storeInfo.phone,
            bankName: storeInfo.bankName ?? null,
            bankAccountNumber: storeInfo.bankAccountNumber ?? null,
            bankAccountName: storeInfo.bankAccountName ?? null,
          },
          copy: { index: cIdx, total: copyCount },
        });
        copyByteArrays.push(singleCopyBytes);
      }

      const totalLen = copyByteArrays.reduce((sum, b) => sum + b.length, 0);
      const escposBytes = new Uint8Array(totalLen);
      let offset = 0;
      for (const b of copyByteArrays) {
        escposBytes.set(b, offset);
        offset += b.length;
      }

      // 4. Send to LAN Printer via TCP 9100
      let printerIp = this.config.printerIp || '192.168.1.73';
      let printerPort = this.config.printerPort || 9100;

      if (printSettings?.printersJson) {
        try {
          const parsed = JSON.parse(printSettings.printersJson);
          if (parsed.networkIp) printerIp = parsed.networkIp;
          if (parsed.networkPort) printerPort = parsed.networkPort;
        } catch {
          // ignore
        }
      }

      console.log(`[PrintAgent] Đang gửi lệnh in tới máy in LAN ${printerIp}:${printerPort}...`);
      await this.transport.send(escposBytes, {
        host: printerIp,
        port: printerPort,
      });

      // 5. Complete
      await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/complete`, {});
      console.log(
        `\x1b[32m✔ [PrintAgent] In thành công job ${job.id} (${printData.orderCode || job.documentId})\x1b[0m`,
      );
      return true;
    } catch (error: any) {
      console.error(`\x1b[31m✘ [PrintAgent] In thất bại cho job ${job.id}:\x1b[0m`, error.message);
      try {
        await this.apiClient.post(`/api/v1/pos/print-jobs/${job.id}/fail`, {
          failureCode: 'PRINT_FAILED',
          failureMessage: error.message || 'Lỗi gửi dữ liệu tới máy in LAN.',
        });
      } catch {
        // ignore
      }
      return false;
    } finally {
      this.inFlight.delete(job.id);
    }
  }
}
