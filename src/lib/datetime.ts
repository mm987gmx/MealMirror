/**
 * Bridges the browser's `datetime-local` inputs and the timestamps the API stores.
 *
 * A `datetime-local` value ("2026-09-13T18:22") carries no timezone, and the
 * server runs in UTC — so posting it raw makes the server read the user's local
 * time as if it were UTC, shifting every meal by the user's offset and shifting
 * it again on every edit. Converting in the browser, where the offset is known,
 * is the only place the intended instant is unambiguous.
 */

/** Local "YYYY-MM-DDTHH:mm" from a datetime-local input -> an absolute UTC ISO timestamp. */
export function localInputToIso(localValue: string): string {
  const parsed = new Date(localValue);
  // Leave unparseable input alone so the server's Zod schema owns the error message.
  return isNaN(parsed.getTime()) ? localValue : parsed.toISOString();
}

/** An absolute ISO timestamp -> the local "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
export function isoToLocalInput(isoString: string): string {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
