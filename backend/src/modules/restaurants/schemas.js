import { z } from 'zod';

export const createMenuItemSchema = z.object({
  name: z.string().min(2).max(140),
  description: z.string().max(400).optional().default(''),
  priceCents: z.number().int().positive()
});

export const updateMenuItemSchema = z.object({
  name: z.string().min(2).max(140).optional(),
  description: z.string().max(400).optional(),
  priceCents: z.number().int().positive().optional(),
  isAvailable: z.boolean().optional()
}).refine((data) => Object.keys(data).length > 0, 'At least one field is required');
