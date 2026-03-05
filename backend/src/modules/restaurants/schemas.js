import { z } from 'zod';

export const createMenuItemSchema = z.object({
  name: z.string().min(2).max(140),
  description: z.string().max(400).optional().default(''),
  priceCents: z.number().int().positive()
});
