import type { z } from 'zod';
import type { submitGuestOrderSchema } from '@contracts/qr-order';

export type SubmitGuestOrderInput = z.infer<typeof submitGuestOrderSchema>;
