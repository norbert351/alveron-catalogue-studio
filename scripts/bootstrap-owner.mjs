import bcrypt from 'bcryptjs';
import pg from 'pg';

const { AUTH_BOOTSTRAP_EMAIL: email, AUTH_BOOTSTRAP_PASSWORD: password, AUTH_BOOTSTRAP_NAME: name } = process.env;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
if (!email || !password || !name) throw new Error('Set AUTH_BOOTSTRAP_EMAIL, AUTH_BOOTSTRAP_PASSWORD, and AUTH_BOOTSTRAP_NAME in .env.local.');
if (password.length < 16) throw new Error('Owner password must contain at least 16 characters.');
if (password.startsWith('replace-')) throw new Error('Replace the placeholder AUTH_BOOTSTRAP_PASSWORD with a unique secret before bootstrapping.');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.startsWith('replace-') || process.env.SESSION_SECRET.length < 32) throw new Error('Replace the SESSION_SECRET placeholder with at least 32 random characters before bootstrapping.');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const existing = await pool.query('SELECT id FROM studio_users LIMIT 1');
  if (existing.rowCount) throw new Error('An owner already exists. Bootstrap is a one-time operation.');
  const hash = await bcrypt.hash(password, 12);
  await pool.query('INSERT INTO studio_users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)', [email.trim().toLowerCase(), name.trim(), hash, 'owner']);
  console.log(`Created the private studio owner account for ${email.trim().toLowerCase()}.`);
} finally {
  await pool.end();
}
