import { z } from 'zod';

export const createMenuItemSchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().min(2).max(140),
  description: z.string().max(400).optional().default(''),
  priceCents: z.number().int().positive()
});
