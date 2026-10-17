const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checked before querying by id: PostgreSQL rejects a malformed UUID with an error (code 22P02) that would
// become a 500. Services answer a malformed id with the same 404 as an unknown one.
export const isUuid = (value: string): boolean => UUID.test(value);
