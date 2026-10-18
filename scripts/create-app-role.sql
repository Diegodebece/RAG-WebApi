-- The API's database user: it can read and change rows, nothing else (no CREATE, DROP, ALTER or TRUNCATE).
-- Run once as the owner (rag), then set its password with \password rag_app.
CREATE ROLE rag_app LOGIN;

GRANT CONNECT ON DATABASE rag TO rag_app;
GRANT USAGE ON SCHEMA public TO rag_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rag_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rag_app;

-- the record of applied migrations belongs to the owner
REVOKE ALL ON schema_migrations FROM rag_app;

-- tables and sequences that future migrations create (as rag) get the same rights
ALTER DEFAULT PRIVILEGES FOR ROLE rag IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rag_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rag IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rag_app;
