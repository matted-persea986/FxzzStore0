import pkg from 'pg';
import 'dotenv/config';
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is missing. Add it in your environment variables before starting the server.');
}

const useSsl =
  process.env.PGSSLMODE === 'disable'
    ? false
    : connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl: useSsl
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL error:', error);
});

export default pool;
