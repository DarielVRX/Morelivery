// backend/modules/auth/schemas.js
import { z } from 'zod';

// ── Registro — nuevo esquema con email real, fullName y alias ────────────────
export const registerSchema = z.object({
  // Nuevos campos
  email:        z.string().email('Correo inválido').max(120),
  fullName:     z.string().trim().min(2).max(80),
  alias:        z.string().trim().min(2).max(50),
  username:     z.string().trim().min(2).max(30).regex(/^[a-zA-Z0-9_.-]+$/).optional(), // candidato, se resuelve en service
  password:     z.string().min(8).max(64),
  role:         z.enum(['customer', 'restaurant', 'driver', 'admin']),
  // Dirección (sigue igual, opcional salvo para restaurant — validado en route)
  address:      z.string().max(220).optional(),
  postalCode:   z.string().trim().regex(/^\d{5}$/).optional(),
  colonia:      z.string().trim().max(120).optional(),
  estado:       z.string().trim().max(120).optional(),
  ciudad:       z.string().trim().max(120).optional(),
  calle:        z.string().trim().max(120).optional(),
  numero:       z.string().trim().max(20).optional(),
  displayName:  z.string().trim().max(80).optional(), // para restaurant
});

// ── Login — acepta email real O username legacy (username@local.test) ─────────
export const loginSchema = z.union([
  // Nuevo: login con email real
  z.object({
    email:    z.string().email(),
    password: z.string().min(1).max(64),
  }),
  // Legacy: login con username (para no romper clientes existentes)
  z.object({
    username: z.string().min(3).max(30),
    password: z.string().min(1).max(64),
  }),
]);

// ── Perfil — sin cambios ──────────────────────────────────────────────────────
const nullableTrimmedString = z.string().trim().max(220).nullable().optional();

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  address:     nullableTrimmedString,
  postalCode:  z.string().trim().regex(/^\d{5}$/).nullable().optional(),
  colonia:     z.string().trim().max(120).nullable().optional(),
  estado:      z.string().trim().max(120).nullable().optional(),
  ciudad:      z.string().trim().max(120).nullable().optional(),
  lat:         z.number().finite().nullable().optional(),
  lng:         z.number().finite().nullable().optional(),
  homeLat:     z.number().finite().nullable().optional(),
  homeLng:     z.number().finite().nullable().optional(),
}).strict();

// ── Forgot / Reset password ───────────────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token:       z.string().min(10),
  newPassword: z.string().min(8).max(64),
});

export const googleAuthSchema = z.object({
  credential: z.string().min(10),
  role: z.enum(['customer', 'restaurant', 'driver']).default('customer'),
});
