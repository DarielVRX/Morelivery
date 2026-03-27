import { z } from 'zod';

export const createOrderSchema = z.object({
  restaurantId:   z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity:   z.number().int().min(1).max(20),
      })
    )
    .min(1),
  payment_method:    z.enum(['cash','card','spei']).optional().default('cash'),
  tip_cents:         z.number().int().min(0).optional().default(0),
  delivery_lat:      z.number().finite().min(-90).max(90).nullish().transform(v => v ?? undefined),
  delivery_lng:      z.number().finite().min(-180).max(180).nullish().transform(v => v ?? undefined),
  delivery_address:  z.string().trim().min(3).max(300).nullish().transform(v => v ?? undefined),
  mp_payment_id:     z.union([z.string().min(1), z.number()]).optional(), // Mercado Pago payment ID
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['accepted','preparing','ready','on_the_way','delivered','cancelled']),
});

export const suggestionSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity:   z.number().int().min(1).max(20),
      })
    )
    .min(1),
});

export const suggestionResponseSchema = z.object({
  accepted: z.boolean(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity:   z.number().int().positive(),
  })).optional(),
});
