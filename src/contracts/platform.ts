import { createEmployeeSchema } from './staff';
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
