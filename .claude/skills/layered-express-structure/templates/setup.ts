// Loaded with --import before every test file: points the app's pool at the test database.
import "dotenv/config";

// Without TEST_DATABASE_URL, DATABASE_URL is removed rather than left pointing at the development
// database, so db.config.ts fails with "DATABASE_URL is not set" instead of emptying real data.
if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
    delete process.env.DATABASE_URL;
}
