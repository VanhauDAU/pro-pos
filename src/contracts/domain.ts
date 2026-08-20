import { z } from 'zod';

export const storeStatusSchema = z.enum(['ACTIVE', 'LOCKED']);
export const tableStatusSchema = z.enum(['AVAILABLE', 'OCCUPIED', 'DISABLED']);
export const orderStatusSchema = z.enum(['OPEN', 'PAYMENT_PENDING', 'PAID', 'CANCELLED']);
export const timeSessionStatusSchema = z.enum(['RUNNING', 'PAUSED', 'ENDED']);
export const paymentStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'VOIDED']);
export const productTypeSchema = z.enum(['QUANTITY', 'WEIGHT', 'TIME']);
export const timeCalculationModeSchema = z.enum(['ACTUAL_TIME', 'TIME_BLOCK']);

export type StoreStatus = z.infer<typeof storeStatusSchema>;
export type TableStatus = z.infer<typeof tableStatusSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type TimeSessionStatus = z.infer<typeof timeSessionStatusSchema>;
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export type ProductType = z.infer<typeof productTypeSchema>;
export type TimeCalculationMode = z.infer<typeof timeCalculationModeSchema>;
