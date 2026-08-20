import { z } from 'zod';

export const actorKindSchema = z.enum(['SUPER_ADMIN', 'OWNER', 'EMPLOYEE']);
export const deviceStatusSchema = z.enum(['ACTIVE', 'REVOKED']);

export const ownerLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
});

export const employeeLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(128),
  pin: z.string().regex(/^\d{4}$/),
});

export const activationConfirmRequestSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
});

export const activationReissueRequestSchema = z.object({
  deviceId: z.uuid(),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(256),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

export const resetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
});

export interface AuthContextResponse {
  actor: null | {
    id: string;
    displayName: string;
    kind: z.infer<typeof actorKindSchema>;
    storeId: string | null;
  };
  device: null | {
    id: string;
    name: string;
    status: z.infer<typeof deviceStatusSchema>;
    storeId: string;
  };
  allowedEntrypoints: Array<'OWNER' | 'EMPLOYEE' | 'PLATFORM'>;
  csrfToken: string | null;
}

export interface LoginResponse {
  actor: NonNullable<AuthContextResponse['actor']>;
  csrfToken: string;
}

export interface ActivationAuthorizationResponse {
  expiresInSeconds: number;
  csrfToken: string;
}

export interface ActivationConfirmationResponse {
  device: NonNullable<AuthContextResponse['device']>;
}
