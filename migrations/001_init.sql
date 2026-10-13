-- pgvector provides the vector type; gen_random_uuid() is built into PostgreSQL 13+
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- one account per email, whatever the capitalization
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    filename text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'indexing', 'ready', 'failed')),
    chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_user_id_idx ON documents (user_id);

-- the cleanup task deletes documents older than the configured lifetime
CREATE INDEX documents_created_at_idx ON documents (created_at);

-- Chunks are stored when the document is uploaded, with a null embedding; the indexing job fills it in.
-- Chunks never appear in URLs, so the natural key is enough, and it also serves neighbor lookups.
CREATE TABLE chunks (
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    text text NOT NULL,
    embedding vector(1024),
    PRIMARY KEY (document_id, chunk_index)
);

CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    type text NOT NULL CHECK (type IN ('index_document', 'answer_question')),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'done', 'failed')),
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz
);

CREATE INDEX jobs_user_id_idx ON jobs (user_id);
CREATE INDEX jobs_document_id_idx ON jobs (document_id);

-- One row per question asked, counted for the daily quota. It has no document reference on purpose,
-- so deleting and re-uploading a document does not reset the quota. The cleanup task removes old rows.
CREATE TABLE question_usage (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    asked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX question_usage_user_id_asked_at_idx ON question_usage (user_id, asked_at);
