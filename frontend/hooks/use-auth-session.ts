"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  clearLegacySessionStorage,
  createGuestSession,
  currentSession,
  deleteGuestSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  requestEmailVerification,
  requestPasswordReset,
} from "@/lib/session";
import type { AuthMode, SessionMode, SessionState, ToastKind } from "@/types/workspace";

const INVALID_LOGIN_MESSAGE = "The credentials do not match.";

type UseAuthSessionOptions = {
  onStatusChange: (status: string) => void;
  pushToast: (kind: ToastKind, message: string) => void;
};

export function useAuthSession({ onStatusChange, pushToast }: UseAuthSessionOptions) {
  const [sessionId, setSessionId] = useState("");
  const [sessionMode, setSessionMode] = useState<SessionMode | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isHydratingSession, setIsHydratingSession] = useState(true);

  const clearLocalSession = useCallback(() => {
    clearLegacySessionStorage();
    setSessionId("");
    setSessionMode(null);
    setCurrentUserEmail(null);
    setEmailVerified(false);
    setAuthMode("login");
    setAuthName("");
    setAuthEmail("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthError("");
  }, []);

  const activateSession = useCallback((session: SessionState) => {
    setSessionId(session.sessionId);
    setSessionMode(session.sessionMode);
    setCurrentUserEmail(session.userEmail);
    setEmailVerified(session.emailVerified);
  }, []);

  const checkEmailVerification = useCallback(async (): Promise<void> => {
    const session = await currentSession("user");

    if (!session) {
      clearLocalSession();
      return;
    }

    activateSession(session);
  }, [activateSession, clearLocalSession]);

  const handleRequestEmailVerification = useCallback(async (): Promise<void> => {
    setAuthError("");
    setIsSigningIn(true);

    try {
      const result = await requestEmailVerification();

      if (result.alreadyVerified) {
        await checkEmailVerification();
        return;
      }

      if (result.emailSent) {
        onStatusChange("Verification email sent");
        pushToast("success", "A new verification email has been sent");
      } else {
        setAuthError("The verification email could not be sent. Please try again later.");
        onStatusChange("Verification email delivery failed");
        pushToast("error", "The verification email could not be sent");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to request email verification";
      setAuthError(message);
      onStatusChange(message);
      pushToast("error", message);
    } finally {
      setIsSigningIn(false);
    }
  }, [checkEmailVerification, onStatusChange, pushToast]);

  useEffect(() => {
    let isCancelled = false;

    const hydrateSession = async () => {
      try {
        const session = await currentSession();

        if (!isCancelled && session) {
          activateSession(session);
        } else if (!isCancelled) {
          clearLocalSession();
        }
      } catch (error) {
        if (!isCancelled) {
          onStatusChange(error instanceof Error ? error.message : "Unable to restore session");
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
  }, [activateSession, clearLocalSession, onStatusChange]);

  useEffect(() => {
    if (!sessionId || !sessionMode) {
      return;
    }

    let isCancelled = false;

    const validateSession = async () => {
      try {
        const session = await currentSession(sessionMode);

        if (!isCancelled && !session) {
          clearLocalSession();
          onStatusChange("Session expired");
          pushToast("info", "Your session expired. Please sign in again.");
        }
      } catch {
        return;
      }
    };

    const handleFocus = () => {
      void validateSession();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void validateSession();
      }
    };

    const intervalId = window.setInterval(() => {
      void validateSession();
    }, 60_000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearLocalSession, onStatusChange, pushToast, sessionId, sessionMode]);

  const clearSession = useCallback(async (): Promise<boolean> => {
    const activeSessionMode = sessionMode;
    clearLocalSession();

    try {
      if (activeSessionMode === "guest") {
        await deleteGuestSession();
      } else if (activeSessionMode === "user") {
        await logoutAccount();
      }

      return true;
    } catch (error) {
      pushToast("error", error instanceof Error ? error.message : "Unable to delete demo workspace");
      return false;
    }
  }, [clearLocalSession, pushToast, sessionMode]);

  const handleGuestAccess = useCallback(async () => {
    setAuthError("");
    setIsSigningIn(true);

    try {
      const guestSession = await createGuestSession();
      activateSession(guestSession);
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

      if (!email || !email.includes("@") || !authPassword) {
        setAuthError(INVALID_LOGIN_MESSAGE);
        return;
      }

      setIsSigningIn(true);

      try {
        const session = await loginAccount(email, authPassword);
        activateSession(session);
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
        const session = await currentSession("user");

        if (session) {
          activateSession(session);
          setAuthName("");
          setAuthEmail("");
          setAuthPassword("");
          setAuthConfirmPassword("");
          onStatusChange("Account created");
          pushToast(
            "success",
            "Verification email sent. You can continue to your workspace without verifying it now."
          );
          return;
        }

        setAuthMode("login");
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthError(result.message);
        onStatusChange("Registration request received");
        pushToast("info", result.message);
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
    emailVerified,
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
    handleRequestEmailVerification,
    checkEmailVerification,
    clearSession,
  };
}
