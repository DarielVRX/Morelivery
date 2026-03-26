// backend/modules/voice/routes.js
import { Router }       from 'express';
import { authenticate } from '../../middlewares/auth.js';
import { AppError }     from '../../utils/errors.js';
import { createRequire } from 'module';
import { Readable }     from 'stream';

const router = Router();

// ── Detectar parser de multipart disponible ───────────────────────────────────
// Usamos multer si está instalado, si no, instrucciones claras.
// Para activar: npm install multer
let upload;
try {
  const require = createRequire(import.meta.url);
  const multer  = require('multer');
  upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB máx
    fileFilter: (_req, file, cb) => {
      const allowed = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'];
      if (allowed.includes(file.mimetype)) cb(null, true);
      else cb(new AppError(415, `Tipo de audio no soportado: ${file.mimetype}`));
    },
  }).single('audio');
} catch {
  upload = null; // multer no instalado
}

// ── POST /api/voice/transcribe ────────────────────────────────────────────────
// Recibe un archivo de audio y devuelve su transcripción vía OpenAI Whisper.
// El frontend graba con MediaRecorder y sube el Blob como multipart/form-data.
//
// Form fields:
//   audio    — Blob de audio (audio/webm, audio/ogg, audio/mp4, audio/wav)
//   context  — string opcional: "delivery_note" | "order_action" | libre
//
// Respuesta:
//   { transcript, confidence, language, command }
//   command: 'accept' | 'reject' | null  — detectado desde transcript
//
// Requiere: npm install multer openai
// Requiere: OPENAI_API_KEY en .env
router.post('/transcribe', authenticate, (req, res, next) => {
  if (!upload) {
    return next(new AppError(501,
      'Transcripción no disponible — instala multer: npm install multer openai'
    ));
  }

  upload(req, res, async (err) => {
    if (err) return next(err instanceof AppError ? err : new AppError(400, err.message));

    try {
      if (!req.file)
        return next(new AppError(400, 'Campo "audio" requerido (multipart/form-data)'));

      const context = req.body?.context ?? 'general';

      // ── Llamada a Whisper (OpenAI) ──────────────────────────────────────────
      let OpenAI;
      try {
        ({ default: OpenAI } = await import('openai'));
      } catch {
        return next(new AppError(501,
          'OpenAI SDK no instalado — ejecuta: npm install openai'
        ));
      }

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Whisper requiere un File-like con .name para inferir el formato
      const audioFile = new File(
        [req.file.buffer],
        `audio.${mimeToExt(req.file.mimetype)}`,
        { type: req.file.mimetype }
      );

      const transcription = await openai.audio.transcriptions.create({
        model:    'whisper-1',
        file:     audioFile,
        language: 'es',        // forzar español — ajustar si necesitas multilang
        response_format: 'verbose_json',
      });

      const transcript = transcription.text?.trim() ?? '';
      const language   = transcription.language ?? 'es';
      // verbose_json no expone confidence directamente; usar segments si existe
      const confidence = transcription.segments?.[0]?.avg_logprob
        ? Math.round(Math.exp(transcription.segments[0].avg_logprob) * 100) / 100
        : null;

      // ── Detección de comandos de voz ────────────────────────────────────────
      // Solo relevante cuando context = 'order_action'
      let command = null;
      if (context === 'order_action') {
        const lower = transcript.toLowerCase();
        if (/\b(listo|acepto|aceptar|confirmar|sí|ok)\b/.test(lower))   command = 'accept';
        else if (/\b(rechazar|rechazo|cancelar|no|nope)\b/.test(lower)) command = 'reject';
      }

      return res.json({ transcript, confidence, language, command });

    } catch (error) {
      // Error de OpenAI — formato legible
      if (error?.status === 400) return next(new AppError(422, 'Audio ilegible o muy corto'));
      return next(error);
    }
  });
});

// ── Helper ────────────────────────────────────────────────────────────────────
function mimeToExt(mime) {
  const map = {
    'audio/webm': 'webm',
    'audio/ogg':  'ogg',
    'audio/mp4':  'mp4',
    'audio/wav':  'wav',
    'audio/mpeg': 'mp3',
  };
  return map[mime] ?? 'webm';
}

export default router;
