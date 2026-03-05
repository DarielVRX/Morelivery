import { z } from 'zod';

export const suspendUserSchema = z.object({
  reason: z.string().min(3).max(180).optional().default('manual moderation')
});
