/** True when a caught error is a Postgres unique_violation (SQLSTATE 23505), surfaced via drizzle's DrizzleQueryError.cause. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}
