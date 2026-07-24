"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  clearStoredSession,
  createGuestSession,
  deleteGuestSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  readStoredSession,
  requestPasswordReset,
} from "@/lib/session";
import type { AuthMode, SessionMode, ToastKind } from "@/types/workspace";

type UseAuthSessionOptions = {
  onStatusChange: (status: string) => void;
  pushToast: (kind: ToastKind, message: string) => void;
};

export function useAuthSession({ onStatusChange, pushToast }: UseAuthSessionOptions) {
  const [sessionId, setSessionId] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const hydrateSession = async () => {
      try {
        const storedSession = await readStoredSession();

        if (!isCancelled && storedSession) {
          setSessionId(storedSession.sessionId);
          setSessionMode(storedSession.sessionMode);
          setCurrentUserEmail(storedSession.userEmail);
        }
      } finally {
        if (!isCancelled) {
          setIsHydratingSession(false);
        }
      }
    };

    void hydrateSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  const activateSession = useCallback((nextSessionId: string, nextSessionMode: SessionMode, userEmail: string | null = null) => {
    if (nextSessionMode === "guest") {
      clearStoredSession();
    }

    setSessionId(nextSessionId);
    setSessionMode(nextSessionMode);
    setCurrentUserEmail(userEmail);
  }, []);

  const clearSession = useCallback(async (): Promise<boolean> => {
    const demoDeletion = sessionMode === "guest" ? deleteGuestSession() : Promise.resolve();
    const accountLogout = sessionMode === "user" ? logoutAccount() : Promise.resolve();

    clearStoredSession();
    setSessionId("");
    setSessionMode(null);
    setCurrentUserEmail(null);
    setAuthMode("login");
    setAuthName("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");

    try {
      await demoDeletion;
      await accountLogout;
      return true;
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Unable to delete demo workspace");
      return false;
    }
  }, [pushToast, sessionMode]);

  const handleGuestAccess = useCallback(async () => {
    setAuthError("");
    setIsSigningIn(true);

    try {
      const guestSession = await createGuestSession();
      activateSession(guestSession.sessionId, "guest");
      onStatusChange("Demo session active");
      pushToast("info", "You are in demo mode");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start demo mode";
      setAuthError(message);
      onStatusChange(message);
      pushToast("error", message);
    } finally {
      setIsSigningIn(false);
    }
  }, [activateSession, onStatusChange, pushToast]);

  const handleSignIn = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthError("");

      const email = authEmail.trim().toLowerCase();

      if (!email.includes("@")) {
        setAuthError("Please use a valid email address");
        return;
      }

      if (authPassword.length < 8) {
        setAuthError("Password must be at least 8 characters");
        return;
      }

      setIsSigningIn(true);

      try {
        const session = await loginAccount(email, authPassword);
        activateSession(session.sessionId, session.sessionMode, session.userEmail);
        onStatusChange("Signed in");
        pushToast("success", "Welcome back");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to sign in";
        setAuthError(message);
        onStatusChange(message);
        pushToast("error", message);
      } finally {
        setIsSigningIn(false);
      }
    },
    [activateSession, authEmail, authPassword, onStatusChange, pushToast]
  );

  const handleRegister = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthError("");

      const name = authName.trim();
      const email = authEmail.trim().toLowerCase();

      if (name.length < 2) {
        setAuthError("Name must be at least 2 characters");
        return;
      }

      if (!email.includes("@")) {
        setAuthError("Please use a valid email address");
        return;
      }

      if (authPassword.length < 8) {
        setAuthError("Password must be at least 8 characters");
        return;
      }

      if (authPassword !== authConfirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }

      setIsSigningIn(true);

      try {
        const result = await registerAccount(name, email, authPassword);
        activateSession(result.session.sessionId, result.session.sessionMode, result.session.userEmail);
        onStatusChange("Account created");
        pushToast(
          result.verificationEmailSent ? "success" : "info",
          result.verificationEmailSent
            ? `Welcome ${name}. Check your email to verify your account.`
            : `Welcome ${name}. Email verification is pending.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to create account";
        setAuthError(message);
        onStatusChange(message);
        pushToast("error", message);
      } finally {
        setIsSigningIn(false);
      }
    },
    [activateSession, authConfirmPassword, authEmail, authName, authPassword, onStatusChange, pushToast]
  );

  const handleForgotPassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setAuthError("");

      const email = authEmail.trim().toLowerCase();

      if (!email.includes("@")) {
        setAuthError("Please use a valid email address");
        return;
      }

      setIsSigningIn(true);

      try {
        await requestPasswordReset(email);
        setAuthMode("login");
        setAuthPassword("");
        setAuthError("If an account exists for that email, recovery instructions will be sent.");
        onStatusChange("Recovery request received");
        pushToast("info", "Check your email for recovery instructions");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to request password recovery";
        setAuthError(message);
        onStatusChange(message);
        pushToast("error", message);
      } finally {
        setIsSigningIn(false);
      }
    },
    [authEmail, onStatusChange, pushToast]
  );

  return {
    sessionId,
    sessionMode,
    currentUserEmail,
    authMode,
    authName,
    authEmail,
    authPassword,
    authConfirmPassword,
    authError,
    isSigningIn,
    isHydratingSession,
    setAuthMode,
    setAuthName,
    setAuthEmail,
    setAuthPassword,
    setAuthConfirmPassword,
    setAuthError,
    handleGuestAccess,
    handleSignIn,
    handleRegister,
    handleForgotPassword,
    clearSession,
  };
}
