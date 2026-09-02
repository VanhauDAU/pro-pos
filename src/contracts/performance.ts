import { z } from 'zod';

export const posPerformanceMetricNameSchema = z.enum([
  'LCP',
  'INP',
  'CLS',
  'TAP_TO_SHELL',
  'TAP_TO_VERIFIED',
  'MUTATION_ACK',
  'API_REQUEST',
  'STARTUP_SHELL',
  'STARTUP_READY',
]);

export const posPerformanceContextSchema = z.enum([
  'AREAS',
  'ORDER',
  'PRODUCT_PICKER',
  'PAYMENT',
  'OVERVIEW',
  'QUOTE',
  'OPEN',
  'SAVE',
  'CANCEL',
  'STOP_TIME',
  'CHECKOUT',
  'OTHER',
]);

export const posPerformanceBatchSchema = z
  .object({
    sessionId: z.uuid(),
    appVersion: z.string().trim().min(1).max(64),
    route: posPerformanceContextSchema,
    device: z
      .object({
        viewportWidth: z.number().int().min(240).max(4096),
        effectiveType: z.enum(['slow-2g', '2g', '3g', '4g', 'unknown']),
        standalone: z.boolean(),
      })
      .strict(),
    metrics: z
      .array(
        z
          .object({
            name: posPerformanceMetricNameSchema,
            context: posPerformanceContextSchema,
            value: z.number().finite().min(0).max(3_600_000),
            status: z.number().int().min(0).max(599).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    occurredAt: z.number().int().positive(),
  })
  .strict();

export type PosPerformanceBatch = z.infer<typeof posPerformanceBatchSchema>;
export type PosPerformanceContext = z.infer<typeof posPerformanceContextSchema>;
export type PosPerformanceMetricName = z.infer<typeof posPerformanceMetricNameSchema>;
