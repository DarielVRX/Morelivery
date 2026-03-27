// backend/src/modules/restaurants/schemas.js
import { z } from 'zod';

export const createMenuItemSchema = z.object({
  name:               z.string().min(2).max(140),
                                             description:        z.string().max(400).optional().default(''),
                                             price_cents:        z.number().int().positive(),
                                             is_available:       z.boolean().optional().default(true),
                                             image_url:          z.string().url().optional().nullable(),
                                             pkg_units:          z.number().int().positive().optional().default(1),
                                             pkg_volume_liters:  z.number().min(0).optional().default(0),
});

export const updateMenuItemSchema = z.object({
  name:               z.string().min(2).max(140).optional(),
                                             description:        z.string().max(400).optional(),
                                             price_cents:        z.number().int().positive().optional(),
                                             is_available:       z.boolean().optional(),
                                             image_url:          z.string().url().optional().nullable(),
                                             pkg_units:          z.number().int().positive().optional(),
                                             pkg_volume_liters:  z.number().min(0).optional(),
}).refine(data => Object.keys(data).length > 0, 'Se requiere al menos un campo');
