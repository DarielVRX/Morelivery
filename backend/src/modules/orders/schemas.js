import { z } from 'zod';

export const createOrderSchema = z.object({
  restaurantId:   z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity:   z.number().int().min(1).max(20)
      })
    )
    .min(1),
  payment_method: z.enum(['cash','card','spei']).optional().default('cash'),
  tip_cents:      z.number().int().min(0).optional().default(0),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready', 'assigned', 'on_the_way', 'delivered', 'cancelled'])
});

export const suggestionSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20)
      })
    )
    .min(1)
});

export const suggestionResponseSchema = z.object({
  accepted: z.boolean(),
  // items opcionales: el cliente puede enviar su versión editada de la sugerencia
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().positive()
  })).optional()
});
