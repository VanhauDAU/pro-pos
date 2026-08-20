import { z } from 'zod';

export const bootstrapSuperAdminSchema = z.object({
  username: z.string().trim().min(3).max(128),
  displayName: z.string().trim().min(1).max(128),
  password: z.string().min(12).max(256),
});

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerDisplayName: z.string().trim().min(1).max(128),
  ownerUsername: z.string().trim().min(3).max(128),
  ownerPassword: z.string().min(12).max(256),
});

export const createEmployeeSchema = z.object({
  displayName: z.string().trim().min(1).max(128),
  username: z.string().trim().min(3).max(128),
  pin: z.string().regex(/^\d{4}$/),
  permissionKeys: z.array(z.string().min(1)).default([]),
});
