import { z } from 'zod';

export const updateStoreSettingsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(32).nullable().optional(),
  address: z.string().trim().min(1).max(500),
  provinceCode: z.number().int().positive().nullable().optional(),
  provinceName: z.string().trim().max(120).nullable().optional(),
  wardCode: z.number().int().positive().nullable().optional(),
  wardName: z.string().trim().max(120).nullable().optional(),
  businessDayCutoffMinutes: z.number().int().min(0).max(1439),
  bankName: z.string().trim().max(120).nullable().optional(),
  bankAccountNumber: z.string().trim().max(64).nullable().optional(),
  bankAccountName: z.string().trim().max(160).nullable().optional(),
  bankQrMediaId: z.uuid().nullable().optional(),
});
