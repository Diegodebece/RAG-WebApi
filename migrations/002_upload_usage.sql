-- One row per accepted upload, counted for the daily upload limit. Like question_usage, it has no document
-- reference on purpose: deleting a document must not give the upload back. The cleanup task removes old rows.
CREATE TABLE upload_usage (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX upload_usage_user_id_uploaded_at_idx ON upload_usage (user_id, uploaded_at);
