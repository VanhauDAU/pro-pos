import { createEmployeeSchema } from './staff';
import { z } from 'zod';

export const bootstrapSuperAdminSchema = z.object({
  username: z.string().trim().min(3).max(128).optional(),
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(128),
  password: z.string().min(6).max(128).optional(),
});

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(160),
  ownerDisplayName: z.string().trim().min(1).max(128),
  ownerEmail: z.string().trim().email().max(254),
  ownerUsername: z.string().trim().min(3).max(128).optional(),
  ownerPassword: z.string().min(6).max(128).optional(),
});

export const setStoreCapabilitySchema = z.object({
  capability: z.literal('POS_REALTIME'),
  enabled: z.boolean(),
});

export { createEmployeeSchema };

export interface PlatformStoreSummary {
  id: string;
  name: string;
  status: 'ACTIVE' | 'LOCKED';
  timezone: string;
  createdAt: number;
  updatedAt: number;
  posRealtimeEnabled: boolean;
}

export interface CreatePlatformStoreResponse {
  storeId: string;
  ownerUserId: string;
}
