import { describe, expect, it } from "vitest";
import { createAdminClient, createTestUser, deleteTestUser } from "./supabase-test-client";

describe("supabase-test-client", () => {
  it("creates and deletes a throwaway test user", async () => {
    const admin = createAdminClient();

    const user = await createTestUser(admin);
    expect(user.id).toBeTruthy();
    expect(user.email).toContain("@example.com");

    const { error: getError } = await admin.auth.admin.getUserById(user.id);
    expect(getError).toBeNull();

    await deleteTestUser(admin, user.id);

    // GoTrue returns a "user_not_found" error here, not a null-user success
    // response (verified empirically — the SDK's UserResponse type claims
    // `user` is non-nullable, which doesn't hold after deletion).
    const { error: afterDeleteError } = await admin.auth.admin.getUserById(user.id);
    expect(afterDeleteError).not.toBeNull();
  });
});
