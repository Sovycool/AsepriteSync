// Set required environment variables before any module is loaded.
// Must be the first file loaded in the test suite.
process.env["DATABASE_URL"] = "postgresql://asepritesync:asepritesync@localhost:5432/asepritesync_test";
process.env["JWT_SECRET"] = "test_secret_at_least_32_characters_long_for_ci";
process.env["NODE_ENV"] = "test";
process.env["REDIS_URL"] = "redis://localhost:6379";
