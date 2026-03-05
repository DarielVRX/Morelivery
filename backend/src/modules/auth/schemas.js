import { z } from 'zod';

export const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(64),
  role: z.enum(['customer', 'restaurant', 'driver', 'admin']),
  address: z.string().max(220).optional()
});

export const loginSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(64)
});

export const profileSchema = z.object({
  address: z.string().min(3).max(220)
});
