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
  role: 'owner' | 'member'
  display_name: string
  title: string
  avatar_mime_type: string | null
  avatar_updated_at: Date | null
  is_protected: boolean
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
        role text NOT NULL CHECK (role IN ('owner', 'member')),
        display_name text NOT NULL DEFAULT 'Cueport user',
        title text NOT NULL DEFAULT '',
        avatar_mime_type text,
        avatar_data bytea,
        avatar_updated_at timestamptz,
        is_protected boolean NOT NULL DEFAULT false,
        deleted_at timestamptz,
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

      CREATE TABLE IF NOT EXISTS cueport_comment_threads (
        id uuid PRIMARY KEY,
        presentation_id uuid NOT NULL REFERENCES cueport_presentations(id) ON DELETE CASCADE,
        slide_id uuid NOT NULL,
        position_x_ppm integer NOT NULL CHECK (position_x_ppm BETWEEN 0 AND 1000000),
        position_y_ppm integer NOT NULL CHECK (position_y_ppm BETWEEN 0 AND 1000000),
        created_by uuid REFERENCES cueport_users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_comments (
        id uuid PRIMARY KEY,
        thread_id uuid NOT NULL REFERENCES cueport_comment_threads(id) ON DELETE CASCADE,
        author_id uuid REFERENCES cueport_users(id) ON DELETE SET NULL,
        author_name text NOT NULL,
        author_title text NOT NULL DEFAULT '',
        body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS cueport_account_invites (
        token_hash text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES cueport_users(id) ON DELETE CASCADE,
        created_by uuid NOT NULL REFERENCES cueport_users(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS cueport_sessions_expiry_idx ON cueport_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS cueport_api_tokens_expiry_idx ON cueport_api_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS cueport_presentations_owner_idx ON cueport_presentations(owner_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS cueport_revision_assets_revision_idx ON cueport_revision_assets(revision_id);
      CREATE INDEX IF NOT EXISTS cueport_comment_threads_presentation_slide_idx
        ON cueport_comment_threads(presentation_id, slide_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS cueport_comments_thread_idx
        ON cueport_comments(thread_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS cueport_account_invites_user_idx
        ON cueport_account_invites(user_id, created_at DESC);
    `)

    // Existing installations began with an owner-only role constraint and no
    // profile columns. Keep the migration explicit and idempotent so every
    // deployed release converges on the same account model.
    await client.query(`
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT 'Cueport user';
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS avatar_mime_type text;
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS avatar_data bytea;
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS is_protected boolean NOT NULL DEFAULT false;
      ALTER TABLE cueport_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
      ALTER TABLE cueport_users DROP CONSTRAINT IF EXISTS cueport_users_role_check;
      ALTER TABLE cueport_users ADD CONSTRAINT cueport_users_role_check CHECK (role IN ('owner', 'member'));
      CREATE UNIQUE INDEX IF NOT EXISTS cueport_single_owner_idx
        ON cueport_users ((role)) WHERE role = 'owner' AND deleted_at IS NULL;
    `)

    // The configured owner is a permanent recovery path. Enforce that rule in
    // PostgreSQL as well as the API so no future route can delete it by mistake.
    await client.query(`
      CREATE OR REPLACE FUNCTION cueport_protect_owner_account()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          IF OLD.is_protected THEN
            RAISE EXCEPTION 'The protected Cueport owner cannot be deleted.';
          END IF;
          RETURN OLD;
        END IF;
        IF OLD.is_protected AND (
          NEW.role <> 'owner' OR
          NEW.email <> OLD.email OR
          NOT NEW.is_protected OR
          NEW.deleted_at IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'The protected Cueport owner identity cannot be changed.';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS cueport_protected_user_delete ON cueport_users;
      DROP TRIGGER IF EXISTS cueport_protected_owner_account ON cueport_users;
      CREATE TRIGGER cueport_protected_owner_account
      BEFORE DELETE OR UPDATE ON cueport_users
      FOR EACH ROW EXECUTE FUNCTION cueport_protect_owner_account();
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
    await client.query(
      `UPDATE cueport_users
       SET role = 'owner', is_protected = true, updated_at = now()
       WHERE email = $1`,
      [ownerEmail]
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
