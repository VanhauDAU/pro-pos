import { z } from 'zod';

export type PrintJobStatus =
  'QUEUED' | 'CLAIMED' | 'PRINTING' | 'COMPLETED' | 'FAILED' | 'UNCERTAIN' | 'CANCELLED';

export type PrintJobDocumentType = 'invoice' | 'provisional' | 'debt_payment';

export type PrintJobRole = 'receipt' | 'temporary_bill' | 'kitchen' | 'bar';

export interface PrintJob {
  id: string;
  storeId: string;
  targetDeviceId: string | null;
  printerRole: string;
  documentType: PrintJobDocumentType;
  documentId: string;
  idempotencyKey: string;
  status: PrintJobStatus;
  requestedByUserId: string | null;
  requestedByDeviceId: string | null;
  claimedByDeviceId: string | null;
  createdAt: number;
  claimedAt: number | null;
  printingAt: number | null;
  completedAt: number | null;
  failedAt: number | null;
  attemptCount: number;
  failureCode: string | null;
  failureMessage: string | null;
  claimLeaseExpiresAt: number | null;
  claimGeneration: number;
  claimProtocolVersion: number;
}

export type PrintJobClaimResponse = PrintJob & { claimToken: string | null };

export const createPrintJobSchema = z.object({
  documentType: z.enum(['invoice', 'provisional', 'debt_payment'], {
    error: 'Loại tài liệu in không hợp lệ (hỗ trợ invoice, provisional, debt_payment)',
  }),
  documentId: z.string().min(1, 'Mã tài liệu không được để trống'),
  printerRole: z.string().min(1).default('receipt'),
  targetDeviceId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(1, 'Khóa chống trùng lặp không được để trống'),
});

export type CreatePrintJobInput = z.infer<typeof createPrintJobSchema>;

export const claimPrintJobSchema = z.object({
  claimedByDeviceId: z.string().optional(),
});

export type ClaimPrintJobInput = z.infer<typeof claimPrintJobSchema>;

export const transitionPrintJobSchema = z.object({
  claimToken: z.string().uuid().optional(),
});

export type TransitionPrintJobInput = z.infer<typeof transitionPrintJobSchema>;

export const failPrintJobSchema = z.object({
  failureCode: z.string().min(1, 'Mã lỗi không được để trống'),
  failureMessage: z.string().optional(),
  claimToken: z.string().uuid().optional(),
});

export type FailPrintJobInput = z.infer<typeof failPrintJobSchema>;

export const printJobQuerySchema = z.object({
  status: z
    .enum(['QUEUED', 'CLAIMED', 'PRINTING', 'COMPLETED', 'FAILED', 'UNCERTAIN', 'CANCELLED'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PrintJobQuery = z.infer<typeof printJobQuerySchema>;

export const pendingPrintJobQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export type PendingPrintJobQuery = z.infer<typeof pendingPrintJobQuerySchema>;

export interface PendingPrintJobPage {
  jobs: PrintJob[];
  nextCursor: string | null;
}
