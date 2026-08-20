import { z } from 'zod';

export const bootstrapSuperAdminSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(128),
});

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerDisplayName: z.string().trim().min(1).max(128),
  ownerEmail: z.string().trim().email().max(254),
});

export const createEmployeeSchema = z.object({
  displayName: z.string().trim().min(1).max(128),
  username: z.string().trim().min(3).max(128),
  pin: z.string().regex(/^\d{4}$/),
  permissionKeys: z.array(z.string().min(1)).default([]),
});

export interface PlatformStoreSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreatePlatformStoreResponse {
  storeId: string;
  ownerUserId: string;
}
