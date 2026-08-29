import type { PosReceiptPrintOptions } from '@domain/receipt/receipt-generator';
import {
  buildPrintDataFromInvoice,
  buildPrintDataFromQuote,
  printReceipt,
  setPosReceiptCsrfToken,
} from './pos-receipt-printer';
import { ApiError, apiRequest, jsonRequest } from './api';
import type { PrintJob } from '@contracts/print-job';
import type { StorePrintSettings } from '@contracts/store';

const PRINT_BRIDGE_STORAGE_KEY = 'propos:print_bridge_enabled';
const LOCK_NAME = 'propos:print_bridge_leader_lock';

let isLeader = false;
let leaderAbortController: AbortController | null = null;
const inFlightJobs = new Set<string>();
const leaderListeners = new Set<(leader: boolean) => void>();

let cachedCsrfToken: string | null = null;

async function resolveCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  try {
    const auth = await apiRequest<{ csrfToken?: string }>('/api/v1/auth/context');
    if (auth?.csrfToken) {
      cachedCsrfToken = auth.csrfToken;
      setPosReceiptCsrfToken(auth.csrfToken);
      return cachedCsrfToken;
    }
  } catch {
    // ignore
  }
  return '';
}

async function authenticatedPost<T>(path: string, body?: unknown): Promise<T> {
  let token = await resolveCsrfToken();
  const send = (csrf: string) =>
    jsonRequest<T>(path, body ?? {}, csrf ? { headers: { 'X-CSRF-Token': csrf } } : {});

  try {
    return await send(token);
  } catch (err: unknown) {
    if (err instanceof ApiError && (err.status === 403 || err.code === 'CSRF_TOKEN_INVALID')) {
      cachedCsrfToken = null;
      setPosReceiptCsrfToken(null);
      token = await resolveCsrfToken();
      return send(token);
    }
    throw err;
  }
}

export function isPrintBridgeLeader(): boolean {
  return isLeader;
}

export function subscribePrintBridgeLeader(listener: (leader: boolean) => void): () => void {
  leaderListeners.add(listener);
  listener(isLeader);
  return () => {
    leaderListeners.delete(listener);
  };
}

function notifyLeaderListeners() {
  for (const listener of leaderListeners) {
    listener(isLeader);
  }
}

/** Check if this platform defaults to desktop */
export function isDesktopPlatform(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return !/iPhone|iPad|iPod|Android|Mobile/i.test(ua);
}

export function isPrintBridgeEnabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  try {
    const stored = localStorage.getItem(PRINT_BRIDGE_STORAGE_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
    return false;
  }
  // Default enabled on Desktop, disabled on Mobile
  return isDesktopPlatform();
}

export function setPrintBridgeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PRINT_BRIDGE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
  if (enabled) {
    void startPrintBridgeLeaderElection();
  } else {
    stopPrintBridgeLeaderElection();
  }
}

/**
 * Elects a single leader tab per browser using the Web Locks API.
 * When the leader tab closes or navigates away, another open tab takes over immediately.
 */
export async function startPrintBridgeLeaderElection(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!isPrintBridgeEnabled()) return;
  if (leaderAbortController) return;

  leaderAbortController = new AbortController();

  if ('locks' in navigator && typeof navigator.locks?.request === 'function') {
    void navigator.locks
      .request(LOCK_NAME, { signal: leaderAbortController.signal }, async () => {
        isLeader = true;
        notifyLeaderListeners();
        if (import.meta.env.DEV) {
          console.log('[PrintBridge] Tab acquired print bridge leader lock.');
        }

        // Recover any pending queued jobs upon becoming leader
        void recoverPendingPrintJobs();

        // Keep the lock held until the tab closes or abort is triggered
        return new Promise<void>((resolve) => {
          leaderAbortController?.signal.addEventListener('abort', () => {
            isLeader = false;
            notifyLeaderListeners();
            resolve();
          });
        });
      })
      .catch(() => {
        // Aborted or lock released
        isLeader = false;
        notifyLeaderListeners();
      });
  } else {
    // Fallback for environments without Web Locks API
    isLeader = true;
    notifyLeaderListeners();
  }
}

export function stopPrintBridgeLeaderElection(): void {
  if (leaderAbortController) {
    leaderAbortController.abort();
    leaderAbortController = null;
  }
  isLeader = false;
  notifyLeaderListeners();
}

/**
 * Processes an incoming print job: claims it atomically, fetches document data,
 * renders receipt via the shared printReceipt service, and reports back status.
 */
export async function processPrintJob(job: {
  id: string;
  documentType: string;
  documentId: string;
  targetDeviceId?: string | null;
  status?: string;
}): Promise<boolean> {
  if (!isPrintBridgeEnabled()) return false;
  if (!isLeader) {
    if (import.meta.env.DEV) {
      console.log('[PrintBridge] Standby tab ignoring job (not leader):', job.id);
    }
    return false;
  }
  if (inFlightJobs.has(job.id)) {
    return false;
  }

  inFlightJobs.add(job.id);
  if (import.meta.env.DEV) {
    console.log('[PrintBridge] Processing print job:', job);
  }

  try {
    // 1. Atomic Claim
    let claimedJob: PrintJob;
    try {
      claimedJob = await authenticatedPost<PrintJob>(`/api/v1/pos/print-jobs/${job.id}/claim`, {});
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[PrintBridge] Claim rejected or conflict:', err);
      }
      return false;
    }

    // 2. Report START (status -> PRINTING)
    try {
      await authenticatedPost(`/api/v1/pos/print-jobs/${job.id}/start`, {});
    } catch {
      // continue
    }

    // 3. Fetch Print Settings & Store Info
    let printSettings: StorePrintSettings | null = null;
    try {
      printSettings = await apiRequest<StorePrintSettings>('/api/v1/pos/print-settings');
    } catch {
      // fallback
    }

    let authContext: {
      actor?: { displayName?: string };
      store?: { name?: string; phone?: string; address?: string };
      csrfToken?: string;
    } | null = null;
    try {
      authContext = await apiRequest('/api/v1/auth/context');
      if (authContext?.csrfToken) {
        cachedCsrfToken = authContext.csrfToken;
        setPosReceiptCsrfToken(authContext.csrfToken);
      }
    } catch {
      // fallback
    }

    let posContext: {
      storeName?: string;
      storePhone?: string | null;
      storeAddress?: string | null;
      bankName?: string | null;
      bankAccountNumber?: string | null;
      bankAccountName?: string | null;
    } | null = null;
    try {
      posContext = await apiRequest('/api/v1/pos/context');
    } catch {
      // fallback
    }

    const storeInfo = {
      storeName: posContext?.storeName ?? authContext?.store?.name ?? 'PRO POS',
      phone: posContext?.storePhone ?? authContext?.store?.phone ?? null,
      address: posContext?.storeAddress ?? authContext?.store?.address ?? null,
      bankName: posContext?.bankName ?? null,
      bankAccountNumber: posContext?.bankAccountNumber ?? null,
      bankAccountName: posContext?.bankAccountName ?? null,
    };

    // 4. Fetch Document Data & Build Print Options
    let receiptOptions: PosReceiptPrintOptions | null = null;

    if (claimedJob.documentType === 'invoice') {
      try {
        const invoiceData = await apiRequest<any>(`/api/v1/pos/invoices/${claimedJob.documentId}`);
        const printData = buildPrintDataFromInvoice(invoiceData);
        receiptOptions = {
          data: printData,
          printSettings,
          storeInfo,
        };
      } catch {
        try {
          const quoteData = await apiRequest<any>(
            `/api/v1/pos/orders/${claimedJob.documentId}/quote`,
          );
          const printData = buildPrintDataFromQuote(quoteData, 'PAYMENT');
          receiptOptions = {
            data: printData,
            printSettings,
            storeInfo,
          };
        } catch {
          // handled below
        }
      }
    } else if (claimedJob.documentType === 'order' || claimedJob.documentType === 'provisional') {
      const quoteData = await apiRequest<any>(`/api/v1/pos/orders/${claimedJob.documentId}/quote`);
      const printData = buildPrintDataFromQuote(
        quoteData,
        claimedJob.documentType === 'order' ? 'PAYMENT' : 'PROVISIONAL',
      );
      receiptOptions = {
        data: printData,
        printSettings,
        storeInfo,
      };
    }

    if (!receiptOptions) {
      await authenticatedPost(`/api/v1/pos/print-jobs/${job.id}/fail`, {
        failureCode: 'INVALID_DOCUMENT',
        failureMessage: `Không tìm thấy hoặc không hỗ trợ loại tài liệu ${claimedJob.documentType}`,
      });
      return false;
    }

    // 5. Call the EXACT existing printerService receipt printer
    const printResult = await printReceipt(receiptOptions);

    // 6. Complete or Fail
    if (printResult.success) {
      await authenticatedPost(`/api/v1/pos/print-jobs/${job.id}/complete`, {});
      if (import.meta.env.DEV) {
        console.log('[PrintBridge] Print completed successfully for job:', job.id);
      }
      return true;
    } else {
      await authenticatedPost(`/api/v1/pos/print-jobs/${job.id}/fail`, {
        failureCode: 'PRINT_FAILED',
        failureMessage: printResult.message ?? 'Máy in không thể in hóa đơn.',
      });
      if (import.meta.env.DEV) {
        console.warn('[PrintBridge] Printing failed:', printResult.message);
      }
      return false;
    }
  } catch (error) {
    try {
      await authenticatedPost(`/api/v1/pos/print-jobs/${job.id}/fail`, {
        failureCode: 'BRIDGE_ERROR',
        failureMessage: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // ignore
    }
    if (import.meta.env.DEV) {
      console.error('[PrintBridge] Error processing print job:', error);
    }
    return false;
  } finally {
    inFlightJobs.delete(job.id);
  }
}

/**
 * Reconnect / recovery sync: fetches any pending QUEUED jobs once and processes them.
 */
export async function recoverPendingPrintJobs(): Promise<void> {
  if (!isPrintBridgeEnabled() || !isLeader) return;

  try {
    const jobs = await apiRequest<PrintJob[]>('/api/v1/pos/print-jobs?status=QUEUED&limit=20');
    if (Array.isArray(jobs)) {
      for (const job of jobs) {
        void processPrintJob(job);
      }
    }
  } catch {
    // Network or auth error
  }
}

// Auto-start leader election on Desktop browser
if (typeof window !== 'undefined' && isPrintBridgeEnabled()) {
  void startPrintBridgeLeaderElection();
}
