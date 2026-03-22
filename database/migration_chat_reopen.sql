-- Migration: add chat_reopened_at to orders
-- Run once. Safe to re-run (IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS chat_reopened_at TIMESTAMPTZ DEFAULT NULL;
