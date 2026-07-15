/** True when a caught error is a Postgres unique_violation (SQLSTATE 23505), surfaced via drizzle's DrizzleQueryError.cause. */
export function isUniqueViolation(error: unknown): boolean {
  return isPgErrorCode(error, '23505');
}

/** True when a caught error is a Postgres foreign_key_violation (SQLSTATE 23503), surfaced via drizzle's DrizzleQueryError.cause. */
export function isForeignKeyViolation(error: unknown): boolean {
  return isPgErrorCode(error, '23503');
}

/** True when a caught error is a Postgres invalid_text_representation (SQLSTATE 22P02, e.g. a malformed uuid literal), surfaced via drizzle's DrizzleQueryError.cause. */
export function isInvalidTextRepresentation(error: unknown): boolean {
  return isPgErrorCode(error, '22P02');
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === code
  );
}
