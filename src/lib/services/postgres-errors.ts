/** Postgres error code 23505 = unique_violation. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

/** Raised by the defer_check_in() RPC when the target check-in is no longer active. */
export function isDeferConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P0001" &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message.includes("defer_conflict")
  );
}
