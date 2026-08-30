import { randomUUID } from 'node:crypto'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { normalizeEmail } from './security'

export interface DatabaseConfig {
  connectionString: string
  ownerEmail: string
}

export interface AuthenticatedUser extends QueryResultRow {
  id: string
  email: string
  password_hash: string | null
  role: 'owner'
}

export function createDatabase(config: DatabaseConfig): Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  })
}

export async function runMigrations(pool: Pool, ownerEmailValue: string): Promise<void> {
  const ownerEmail = normalizeEmail(ownerEmailValue)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS cueport_users (
        id uuid PRIMARY KEY,
        email text NOT NULL UNIQUE,
        password_hash text,
        role text NOT NULL CHECK (role IN ('owner')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_sessions (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES cueport_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_api_tokens (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES cueport_users(id) ON DELETE CASCADE,
        label text NOT NULL,
        expires_at timestamptz NOT NULL,
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_presentations (
        id uuid PRIMARY KEY,
        owner_id uuid NOT NULL REFERENCES cueport_users(id) ON DELETE CASCADE,
        name text NOT NULL,
        published_revision_id uuid,
        share_token_hash text UNIQUE,
        share_token_cipher text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_revisions (
        id uuid PRIMARY KEY,
        presentation_id uuid NOT NULL REFERENCES cueport_presentations(id) ON DELETE CASCADE,
        revision_number integer NOT NULL,
        status text NOT NULL CHECK (status IN ('draft', 'published')),
        document jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz,
        UNIQUE (presentation_id, revision_number)
      );

      CREATE TABLE IF NOT EXISTS cueport_revision_assets (
        id uuid PRIMARY KEY,
        revision_id uuid NOT NULL REFERENCES cueport_revisions(id) ON DELETE CASCADE,
        asset_key text NOT NULL,
        mime_type text NOT NULL,
        expected_bytes bigint NOT NULL CHECK (expected_bytes >= 0),
        stored_bytes bigint,
        storage_name text NOT NULL,
        uploaded_at timestamptz,
        UNIQUE (revision_id, asset_key)
      );

      CREATE INDEX IF NOT EXISTS cueport_sessions_expiry_idx ON cueport_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS cueport_api_tokens_expiry_idx ON cueport_api_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS cueport_presentations_owner_idx ON cueport_presentations(owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS cueport_revision_assets_revision_idx ON cueport_revision_assets(revision_id);
    `)

    // The circular published-revision reference is added after both tables
    // exist. This migration remains idempotent for fresh and existing servers.
    const constraint = await client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cueport_published_revision_fk'
      ) AS exists
    `)
    if (!constraint.rows[0]?.exists) {
      await client.query(`
        ALTER TABLE cueport_presentations
        ADD CONSTRAINT cueport_published_revision_fk
        FOREIGN KEY (published_revision_id) REFERENCES cueport_revisions(id) ON DELETE SET NULL
      `)
    }

    await client.query(
      `INSERT INTO cueport_users (id, email, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), ownerEmail]
    )
    await client.query('DELETE FROM cueport_sessions WHERE expires_at <= now()')
    await client.query('DELETE FROM cueport_api_tokens WHERE expires_at <= now()')
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
