import { describe, expect, it } from "vitest";
import { isoToLocalInput, localInputToIso } from "./datetime";

describe("datetime-local <-> ISO conversion", () => {
  it("round-trips an instant through the input format without drifting", () => {
    const original = "2026-09-13T16:22:00.000Z";
    expect(localInputToIso(isoToLocalInput(original))).toBe(original);
  });

  it("survives repeated edit round-trips, which is how the shift used to compound", () => {
    const original = "2026-09-13T16:22:00.000Z";
    let value = original;
    for (let i = 0; i < 5; i++) {
      value = localInputToIso(isoToLocalInput(value));
    }
    expect(value).toBe(original);
  });

  it("reads a local input as local time, not as UTC", () => {
    const localValue = "2026-09-13T18:22";
    const expectedOffsetMinutes = new Date(localValue).getTimezoneOffset();
    const iso = localInputToIso(localValue);
    // 18:22 local is 18:22 + offset in UTC; asserting via the offset keeps this
    // test honest in whatever timezone CI happens to run in.
    expect(new Date(iso).getUTCHours() * 60 + new Date(iso).getUTCMinutes()).toBe(18 * 60 + 22 + expectedOffsetMinutes);
  });

  it("passes malformed input straight through for the server's validator to reject", () => {
    expect(localInputToIso("not a date")).toBe("not a date");
    expect(isoToLocalInput("not a date")).toBe("");
  });
});
