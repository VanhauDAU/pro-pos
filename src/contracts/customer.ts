import { z } from 'zod';

import { VIETNAM_PHONE_REGEX } from './store';

export const customerGenderSchema = z.enum(['MALE', 'FEMALE', 'OTHER']);
export const customerStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập họ tên.').max(160),
  phone: z.string().trim().regex(VIETNAM_PHONE_REGEX, 'Số điện thoại không hợp lệ.'),
  email: z.email().max(255).nullable().optional(),
  birthDate: z.iso.date().nullable().optional(),
  gender: customerGenderSchema.nullable().optional(),
  provinceCode: z.number().int().positive().nullable().optional(),
  provinceName: z.string().trim().max(120).nullable().optional(),
  wardCode: z.number().int().positive().nullable().optional(),
  wardName: z.string().trim().max(120).nullable().optional(),
  addressLine: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
export const customerImportSchema = z.object({
  rows: z.array(customerInputSchema).min(1).max(5000),
});
export type CustomerGender = z.infer<typeof customerGenderSchema>;

export interface CustomerSummary {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: CustomerGender | null;
  status: 'ACTIVE' | 'ARCHIVED';
  invoiceCount: number;
  totalSpentVnd: number;
  averageSpentVnd: number;
  loyaltyPoints: number;
  debtBalanceVnd: number;
  lastOrderAt: number | null;
  groups: Array<{ id: string; name: string }>;
}

export interface CustomerDetail extends CustomerSummary {
  birthDate: string | null;
  provinceCode: number | null;
  provinceName: string | null;
  wardCode: number | null;
  wardName: string | null;
  addressLine: string | null;
  note: string | null;
  invoices: Array<{ id: string; displayCode: string; totalVnd: number; issuedAt: number }>;
  loyaltyEntries: LoyaltyEntry[];
  debtEntries: DebtEntry[];
}

export interface LoyaltyEntry {
  id: string;
  invoiceId: string | null;
  entryType: 'EARN' | 'REVERSAL' | 'ADJUSTMENT';
  points: number;
  balanceAfter: number;
  note: string | null;
  createdAt: number;
}

export interface DebtEntry {
  id: string;
  invoiceId: string | null;
  entryType: 'CHARGE' | 'PAYMENT' | 'ADJUSTMENT' | 'REVERSAL';
  amountVnd: number;
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | null;
  reference: string | null;
  note: string | null;
  createdAt: number;
}

export const customerGroupRuleSchema = z.object({
  field: z.enum(['BIRTH_MONTH', 'PROVINCE', 'WARD', 'INVOICE_COUNT', 'TOTAL_SPENT', 'GENDER']),
  operator: z.enum(['EQUAL', 'LESS_THAN', 'GREATER_THAN', 'BETWEEN']),
  value: z.union([z.string(), z.number()]),
  valueTo: z.number().optional(),
});
export type CustomerGroupRule = z.infer<typeof customerGroupRuleSchema>;

export const customerGroupInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    membershipType: z.enum(['MANUAL', 'AUTOMATIC']),
    customerIds: z.array(z.uuid()).default([]),
    rules: z.array(customerGroupRuleSchema).default([]),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.membershipType === 'AUTOMATIC' && value.rules.length === 0) {
      context.addIssue({ code: 'custom', path: ['rules'], message: 'Vui lòng thêm điều kiện.' });
    }
  });

export type CustomerGroupInput = z.infer<typeof customerGroupInputSchema>;
export interface CustomerGroup {
  id: string;
  name: string;
  membershipType: 'MANUAL' | 'AUTOMATIC';
  rules: CustomerGroupRule[];
  note: string | null;
  customerCount: number;
  customerIds: string[];
  createdAt: number;
  updatedAt: number;
}

export const debtPaymentSchema = z.object({
  amountVnd: z.number().int().positive(),
  method: z.enum(['CASH', 'BANK_TRANSFER']),
  note: z.string().trim().max(500).nullable().optional(),
  idempotencyKey: z.string().min(8).max(128),
});

export const debtAdjustmentSchema = z.object({
  amountVnd: z
    .number()
    .int()
    .refine((value) => value !== 0),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().min(8).max(128),
});

export const loyaltySettingsSchema = z.object({
  enabled: z.boolean(),
  vndPerPoint: z.number().int().positive().max(1_000_000_000),
});

export interface PaymentAllocation {
  method: 'CASH' | 'BANK_TRANSFER' | 'DEBT';
  amountVnd: number;
  tenderedVnd?: number;
}
