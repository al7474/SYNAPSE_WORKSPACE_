"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { AuthScreen } from "@/components/auth/auth-screen";
import { SessionLoadingScreen } from "@/components/auth/session-loading-screen";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useToasts } from "@/hooks/use-toasts";
import type { AuthMode } from "@/types/workspace";

const WorkspaceEntry = dynamic(() => import("@/components/workspace/workspace-entry"), {
  loading: () => (
    <SessionLoadingScreen
      isWaking={false}
      elapsedSeconds={0}
      status="Loading workspace..."
    />
  ),
});

export default function HomePage() {
  const [status, setStatus] = useState("Initializing secure workspace environment...");
  const { toasts, pushToast } = useToasts();

  const auth = useAuthSession({
    onStatusChange: setStatus,
    pushToast,
  });

  const handleAuthModeChange = (mode: AuthMode) => {
    auth.setAuthMode(mode);
    auth.setAuthError("");
  };

  if (auth.isHydratingSession || auth.sessionHydrationError) {
    return (
      <SessionLoadingScreen
        error={auth.sessionHydrationError || undefined}
        isWaking={auth.isBackendWaking}
        elapsedSeconds={auth.backendWakeElapsedSeconds}
        status={status}
        onRetry={auth.sessionHydrationError ? auth.retrySessionHydration : undefined}
      />
    );
  }

  if (!auth.sessionId || !auth.sessionMode) {
    return (
      <AuthScreen
        authMode={auth.authMode}
        authName={auth.authName}
        authEmail={auth.authEmail}
        authPassword={auth.authPassword}
        authConfirmPassword={auth.authConfirmPassword}
        authError={auth.authError}
        isSigningIn={auth.isSigningIn}
        onAuthModeChange={handleAuthModeChange}
        onNameChange={auth.setAuthName}
        onEmailChange={auth.setAuthEmail}
        onPasswordChange={auth.setAuthPassword}
        onConfirmPasswordChange={auth.setAuthConfirmPassword}
        onAuthErrorChange={auth.setAuthError}
        onGuestAccess={auth.handleGuestAccess}
        onSignIn={auth.handleSignIn}
        onRegister={auth.handleRegister}
        onForgotPassword={auth.handleForgotPassword}
      />
    );
  }

  const authenticatedAuth = {
    ...auth,
    sessionId: auth.sessionId,
    sessionMode: auth.sessionMode,
  };

  return <WorkspaceEntry auth={authenticatedAuth} pushToast={pushToast} toasts={toasts} onStatusChange={setStatus} />;
}
