// backend/src/utils/nameFilter.js
// Lista de términos bloqueados para nombres de usuario y alias.
// No es exhaustiva — cubre los casos más comunes y obvios.
// Se compara contra versión normalizada (sin acentos, minúsculas).
import { ROUTER_BRAND } from '../config/brand.js';

const BLOCKED_TERMS = [
  // Insultos y ofensas en español
  'puta', 'puto', 'pendejo', 'pendeja', 'cabron', 'cabrona', 'chinga',
  'chingada', 'chingon', 'joto', 'maricon', 'marica', 'pinche', 'culero',
  'culera', 'mamona', 'malon', 'idiota', 'imbecil', 'estupido', 'estupida',
  'mierda', 'verga', 'pene', 'vagina', 'culo', 'nalgas', 'tetas',
  'zorra', 'perra', 'prostituta', 'guey', 'buey', 'wey',
  // Insultos en inglés
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick',
  'cock', 'pussy', 'nigga', 'nigger', 'faggot', 'retard', 'whore',
  // Términos de odio / discriminación
  'nazi', 'Hitler', 'kkk',
  // Suplantación de identidad
  'admin', 'soporte', ROUTER_BRAND, 'support', 'sistema',
];

function normalize(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar acentos
    .replace(/[^a-z0-9]/g, '');      // solo alfanumérico
}

/**
 * Verifica si un nombre o alias contiene términos bloqueados.
 * @param {string} name
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkName(name) {
  if (!name || typeof name !== 'string') return { ok: true };
  const normalized = normalize(name);

  for (const term of BLOCKED_TERMS) {
    if (normalized.includes(normalize(term))) {
      return { ok: false, reason: 'El nombre contiene términos no permitidos.' };
    }
  }
  return { ok: true };
}
