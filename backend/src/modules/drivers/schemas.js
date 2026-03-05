import { z } from 'zod';

export const availabilitySchema = z.object({
  isAvailable: z.boolean()
});

export const driverOrderResponseSchema = z.object({
  accepted: z.boolean()
});
