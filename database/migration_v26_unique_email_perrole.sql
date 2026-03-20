DROP INDEX IF EXISTS users_real_email_idx;
CREATE UNIQUE INDEX users_real_email_role_idx
  ON users (real_email, role)
  WHERE real_email IS NOT NULL;
