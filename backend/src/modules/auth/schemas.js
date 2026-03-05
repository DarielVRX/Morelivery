import { z } from 'zod';

export const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(64),
  role: z.enum(['customer', 'restaurant', 'driver', 'admin'])
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(64)
});
