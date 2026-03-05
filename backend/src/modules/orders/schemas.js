import { z } from 'zod';

export const createOrderSchema = z.object({
  restaurantId: z.string().uuid(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20)
      })
    )
    .min(1)
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
  // Items editados por el cliente (opcionales — si no vienen se usan los de la sugerencia original)
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(20)
  })).optional()
});
