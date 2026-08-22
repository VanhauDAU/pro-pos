import { z } from 'zod';

export const actorKindSchema = z.enum(['SUPER_ADMIN', 'OWNER', 'EMPLOYEE']);
export const deviceStatusSchema = z.enum(['ACTIVE', 'REVOKED']);
export const accessAuthPurposeSchema = z.enum([
  'OWNER_LOGIN',
  'PLATFORM_LOGIN',
  'DEVICE_ACTIVATION',
  'DEVICE_REISSUE',
]);

export const accessStartRequestSchema = z.object({
  purpose: accessAuthPurposeSchema,
  deviceId: z.uuid().optional(),
});

export const employeeLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(128),
  pin: z.string().regex(/^\d{4}$/),
});

export const ownerLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().default(false).optional(),
});

export const platformLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const directDeviceActivationRequestSchema = z.object({
  username: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
  deviceName: z.string().trim().min(1).max(80),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(6).max(128),
});

export const activationConfirmRequestSchema = z.object({
  deviceName: z.string().trim().min(1).max(80),
});

export const resetPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/),
});

export const updateOwnerAccountSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập họ và tên chủ cửa hàng.')
    .max(128, 'Họ và tên tối đa 128 ký tự.'),
  phone: z
    .string()
    .trim()
    .max(11)
    .regex(/^(?:02\d{8,9}|0[35789]\d{8})$/, 'Số điện thoại không đúng định dạng Việt Nam.')
    .nullable()
    .optional()
    .or(z.literal('')),
  email: z
    .string()
    .trim()
    .email('Email không đúng định dạng.')
    .max(254, 'Email tối đa 254 ký tự.')
    .nullable()
    .optional()
    .or(z.literal('')),
});

export type UpdateOwnerAccountInput = z.infer<typeof updateOwnerAccountSchema>;

export interface OwnerAccountProfile {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  storeId: string;
  storeName?: string;
  createdAt: number;
}

export type AccessAuthPurpose = z.infer<typeof accessAuthPurposeSchema>;

export interface AccessStartResponse {
  loginUrl: string;
  expiresInSeconds: number;
}

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
    storeName?: string;
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
