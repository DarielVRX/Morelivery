import { z } from 'zod';

export const createOrderSchema = z.object({
  restaurantId: z.string().uuid(),
  totalCents: z.number().int().positive(),
  address: z.string().min(5).max(220),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(20),
        unitPriceCents: z.number().int().positive()
      })
    )
    .min(1)
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(['accepted', 'preparing', 'ready', 'assigned', 'on_the_way', 'delivered', 'cancelled'])
});
