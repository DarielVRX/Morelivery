import { AppError } from '../utils/errors.js';

export function notFoundHandler(_req, res) {
  res.status(404).json({
    error: 'La página solicitada no está disponible. Por favor, verifica la dirección o regresa al inicio'
  });
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err?.code) {
    console.error(`[DB Error]: ${err.code} - ${err.message}`);

    return res.status(500).json({
      error: 'No fue posible completar la solicitud en este momento. Por favor, inténtalo de nuevo en unos instantes'
    });
  }

  console.error('[System Error]:', err);

  return res.status(500).json({
    error: 'Estamos experimentando dificultades técnicas temporales. Agradecemos tu paciencia mientras lo solucionamos'
  });
}
