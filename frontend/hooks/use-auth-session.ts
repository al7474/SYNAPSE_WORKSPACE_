"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  clearStoredSession,
  createGuestSessionId,
  createUserSessionId,
  persistSession,
  readStoredSession,
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
    const storedSession = readStoredSession();

    if (storedSession) {
      setSessionId(storedSession.sessionId);
      setSessionMode(storedSession.sessionMode);
      setCurrentUserEmail(storedSession.userEmail);
    }

    setIsHydratingSession(false);
  }, []);

  const activateSession = useCallback((nextSessionId: string, nextSessionMode: SessionMode, userEmail: string | null = null) => {
    persistSession(nextSessionId, nextSessionMode, userEmail);
    setSessionId(nextSessionId);
    setSessionMode(nextSessionMode);
    setCurrentUserEmail(userEmail);
  }, []);

  const clearSession = useCallback(() => {
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
  }, []);

  const handleGuestAccess = useCallback(() => {
    activateSession(createGuestSessionId(), "guest");
    onStatusChange("Guest session active");
    pushToast("info", "You are in guest mode");
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

      if (authPassword.trim().length < 6) {
        setAuthError("Password must be at least 6 characters");
        return;
      }

      setIsSigningIn(true);

      try {
        activateSession(createUserSessionId(email), "user", email);
        onStatusChange("Signed in");
        pushToast("success", "Welcome back");
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

      if (authPassword.trim().length < 6) {
        setAuthError("Password must be at least 6 characters");
        return;
      }

      if (authPassword !== authConfirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }

      setIsSigningIn(true);

      try {
        activateSession(createUserSessionId(email), "user", email);
        onStatusChange("Account created");
        pushToast("success", `Welcome ${name}`);
      } finally {
        setIsSigningIn(false);
      }
    },
    [activateSession, authConfirmPassword, authEmail, authName, authPassword, onStatusChange, pushToast]
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
    clearSession,
  };
}
