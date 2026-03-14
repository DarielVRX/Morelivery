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

const nullableTrimmedString = z.string().trim().max(220).nullable().optional();

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  address: nullableTrimmedString,
  postalCode: z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  colonia: z.string().trim().max(120).nullable().optional(),
  estado: z.string().trim().max(120).nullable().optional(),
  ciudad: z.string().trim().max(120).nullable().optional(),
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
  homeLat: z.number().finite().nullable().optional(),
  homeLng: z.number().finite().nullable().optional(),
}).strict();
