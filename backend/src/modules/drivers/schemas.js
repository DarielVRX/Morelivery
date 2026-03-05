import { z } from 'zod';

export const availabilitySchema = z.object({
  isAvailable: z.boolean()
});
