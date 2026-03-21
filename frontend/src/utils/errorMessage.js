export function getErrorMessage(error, fallback = 'Ocurrió un error') {
  if (typeof error === 'string' && error.trim()) return error;
  if (error?.message && String(error.message).trim()) return String(error.message).trim();
  return fallback;
}
