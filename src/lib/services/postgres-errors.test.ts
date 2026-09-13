import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./postgres-errors";

describe("isUniqueViolation", () => {
  it("returns true for a Postgres unique-violation error object", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("returns false for a different Postgres error code", () => {
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("returns false for an object without a code property", () => {
    expect(isUniqueViolation({ message: "oops" })).toBe(false);
  });

  it("returns false for non-object input", () => {
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("error")).toBe(false);
  });
});
