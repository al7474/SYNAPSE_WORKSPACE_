import { Pool } from "pg";
import { AuthError, AuthService } from "../../backend/src/modules/auth/auth.service.js";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5434/synapse";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const authService = new AuthService(pool, {
    sessionTtlMs: 3600000,
    actionTokenTtlMs: 3600000,
    bcryptCost: 12,
  });
  const email = `auth-token-smoke-${Date.now()}@example.com`;
  const oldPassword = "old-password-123";
  const newPassword = "new-password-456";
  let userId: string | null = null;

  try {
    const registration = await authService.register({
      name: "Auth Token Smoke",
      email,
      password: oldPassword,
    });
    assert(Boolean(registration), "Registration did not create an account");
    userId = registration!.verification.user.id;

    const userRow = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [userId]
    );
    const passwordHash = userRow.rows[0]?.password_hash || "";
    assert(passwordHash.startsWith("$2b$"), "Password was not stored as bcrypt");
    assert(passwordHash !== oldPassword, "Raw password was stored");

    const verified = await authService.verifyEmail(registration!.verification.token);
    assert(verified.email === email, "Verification returned the wrong account");

    let verificationWasRejected = false;

    try {
      await authService.verifyEmail(registration!.verification.token);
    } catch (error) {
      verificationWasRejected = error instanceof AuthError && error.code === "INVALID_TOKEN";
    }

    assert(verificationWasRejected, "Verification token was reusable");

    const firstSession = await authService.login(email, oldPassword);
    const secondSession = await authService.login(email, oldPassword);
    await authService.changePassword(firstSession.token, oldPassword, newPassword);
    assert(
      (await authService.resolveSession(firstSession.token)) === null,
      "Password change did not revoke the active session"
    );
    assert(
      (await authService.resolveSession(secondSession.token)) === null,
      "Password change did not revoke the second session"
    );

    let oldPasswordWasRejectedAfterChange = false;

    try {
      await authService.login(email, oldPassword);
    } catch (error) {
      oldPasswordWasRejectedAfterChange = error instanceof AuthError && error.code === "INVALID_CREDENTIALS";
    }

    assert(oldPasswordWasRejectedAfterChange, "Old password remained valid after password change");
    const changedSession = await authService.login(email, newPassword);
    const reset = await authService.requestPasswordReset(email);
    assert(Boolean(reset), "Password reset token was not created");

    await authService.resetPassword(reset!.token, newPassword);
    assert(
      (await authService.resolveSession(secondSession.token)) === null,
      "Password reset did not revoke the second session"
    );
    assert(
      (await authService.resolveSession(changedSession.token)) === null,
      "Password reset did not revoke the changed-password session"
    );

    let oldPasswordWasRejected = false;

    try {
      await authService.login(email, oldPassword);
    } catch (error) {
      oldPasswordWasRejected = error instanceof AuthError && error.code === "INVALID_CREDENTIALS";
    }

    assert(oldPasswordWasRejected, "Old password remained valid after reset");
    const newSession = await authService.login(email, newPassword);
    assert(newSession.context.user.email === email, "New password could not log in");

    const secondReset = await authService.requestPasswordReset(email);
    assert(Boolean(secondReset), "Second password reset token was not created");
    await authService.resetPassword(secondReset!.token, oldPassword);

    let resetWasRejected = false;

    try {
      await authService.resetPassword(secondReset!.token, newPassword);
    } catch (error) {
      resetWasRejected = error instanceof AuthError && error.code === "INVALID_TOKEN";
    }

    assert(resetWasRejected, "Password reset token was reusable");

    console.log(
      JSON.stringify(
        {
          email,
          userId,
          bcryptHashStored: true,
          verificationSingleUse: true,
          passwordChangeRevokedSessions: true,
          resetRevokedSessions: true,
          resetSingleUse: true,
        },
        null,
        2
      )
    );
  } finally {
    if (userId) {
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }

    await pool.end();
  }
}

main().catch((error) => {
  console.error("Authentication token smoke test failed:");
  console.error(error);
  process.exit(1);
});