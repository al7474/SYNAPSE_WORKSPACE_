"use client";

import { Heading } from "@/components/ui/heading";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthMode } from "@/types/workspace";

const GUEST_ACCESS_ICON_URL = "https://www.figma.com/api/mcp/asset/94931bfe-7097-4580-b779-eeb53f4c0f0e";

const AUTH_INPUT_CLASS_NAME =
  "h-control min-w-0 rounded-none border-overlay/10 bg-transparent px-inset-lg py-inset font-mono text-caption font-normal leading-normal text-muted-foreground placeholder:text-muted-foreground focus-visible:ring-0";
const AUTH_SUBMIT_CLASS_NAME =
  "h-control w-full rounded-none border border-overlay/10 bg-transparent px-inset-lg py-inset font-mono text-caption font-normal uppercase leading-4 tracking-caps text-foreground shadow-none hover:bg-overlay/5";

type AuthScreenProps = {
  authMode: AuthMode;
  authName: string;
  authEmail: string;
  authPassword: string;
  authConfirmPassword: string;
  authError: string;
  isSigningIn: boolean;
  onAuthModeChange: (mode: AuthMode) => void;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onAuthErrorChange: (value: string) => void;
  onGuestAccess: () => void;
  onSignIn: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onRegister: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onForgotPassword: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

export function AuthScreen({
  authMode,
  authName,
  authEmail,
  authPassword,
  authConfirmPassword,
  authError,
  isSigningIn,
  onAuthModeChange,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onAuthErrorChange,
  onGuestAccess,
  onSignIn,
  onRegister,
  onForgotPassword,
}: AuthScreenProps) {
  const isLoginMode = authMode === "login";
  const isForgotPasswordMode = authMode === "forgot-password";

  const switchAuthMode = () => {
    onAuthModeChange(isLoginMode ? "register" : "login");
    onAuthErrorChange("");
  };

  const openForgotPassword = () => {
    onAuthModeChange("forgot-password");
    onAuthErrorChange("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center overflow-y-auto bg-background px-4 py-8 text-bright">
      <section className="flex w-full max-w-auth-card flex-col gap-7 border border-overlay/10 bg-card-translucent/40 p-10">
        <header className="flex h-auth-header w-full shrink-0 flex-col items-center">
          <div className="grid h-16 w-16 place-items-center border border-overlay/10 bg-secondary">
            <span className="w-icon-lg text-center font-sans text-label font-medium leading-body-sm text-muted-foreground">
              Synapse
            </span>
          </div>
          <div className="pt-5">
            <Heading level={1} className="font-sans text-subheading font-normal leading-7 text-foreground">Synapse Workspace</Heading>
          </div>
          <div className="pt-1">
            <p className="font-mono text-label font-normal uppercase leading-label tracking-label-lg text-muted-foreground">
              {isLoginMode
                ? "Sign in to continue"
                : isForgotPasswordMode
                  ? "Recover your account"
                  : "Create your account"}
            </p>
          </div>
        </header>

        <div className="border border-success-soft/20 bg-success-soft/4 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-label font-normal uppercase tracking-label-lg text-success-text">
              Demo mode
            </span>
            <span className="font-mono text-micro font-normal uppercase tracking-label text-muted-foreground">
              No account required
            </span>
          </div>
          <p className="pt-1 font-mono text-label font-normal leading-label text-muted-foreground">
            Temporary workspace for exploring Synapse.
          </p>
        </div>

        <Button
          data-testid="enter-demo"
          className="h-row-md min-h-0 w-full rounded-none bg-primary-hover px-4 pb-4 pt-5 font-mono text-caption font-normal uppercase tracking-caps text-card shadow-none hover:bg-primary-hover"
          onClick={onGuestAccess}
          disabled={isSigningIn}
        >
          <img src={GUEST_ACCESS_ICON_URL} alt="" aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="text-center leading-body">{isSigningIn ? "Starting Demo..." : "Enter Demo Mode"}</span>
        </Button>

        <div className="flex h-inset-lg w-full items-center gap-3 font-mono text-label font-normal leading-label text-muted-foreground">
          <div className="h-px min-w-0 flex-1 bg-overlay/10" />
          <span className="shrink-0 uppercase tracking-label-lg">Account mode</span>
          <div className="h-px min-w-0 flex-1 bg-overlay/10" />
        </div>

        {isForgotPasswordMode ? (
          <form id="account-auth-form" className="flex w-full flex-col gap-4" onSubmit={onForgotPassword}>
            <p className="font-mono text-label leading-label text-muted-foreground">
              Enter your account email and we will send recovery instructions if it is registered.
            </p>
            <Input
              id="forgot-password-email"
              type="email"
              autoComplete="email"
              value={authEmail}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="Email"
              className={AUTH_INPUT_CLASS_NAME}
              required
            />
            {authError && <p className="break-words font-mono text-caption text-danger-foreground">{authError}</p>}
            <div className="w-full pt-2">
              <Button type="submit" disabled={isSigningIn} className={AUTH_SUBMIT_CLASS_NAME}>
                {isSigningIn ? "Sending..." : "Send Recovery Email"}
              </Button>
            </div>
          </form>
        ) : isLoginMode ? (
          <form id="account-auth-form" noValidate className="flex w-full flex-col gap-4" onSubmit={onSignIn}>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={authEmail}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="Email"
              className={AUTH_INPUT_CLASS_NAME}
            />
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={authPassword}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Password"
              className={AUTH_INPUT_CLASS_NAME}
            />
            {authError && <p className="break-words font-mono text-caption text-danger-foreground">{authError}</p>}
            <div className="w-full pt-2">
              <Button type="submit" disabled={isSigningIn} className={AUTH_SUBMIT_CLASS_NAME}>
                {isSigningIn ? "Signing In..." : "Sign In"}
              </Button>
            </div>
            <Button variant="unstyled"
              type="button"
              className="font-mono text-label font-normal uppercase leading-label tracking-label-lg text-muted-foreground"
              onClick={openForgotPassword}
            >
              Forgot password?
            </Button>
          </form>
        ) : (
          <form id="account-auth-form" className="flex w-full flex-col gap-4" onSubmit={onRegister}>
            <Input
              id="name"
              type="text"
              autoComplete="name"
              value={authName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Full name"
              className={AUTH_INPUT_CLASS_NAME}
              required
            />
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              value={authEmail}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="Email"
              className={AUTH_INPUT_CLASS_NAME}
              required
            />
            <Input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={authPassword}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="Password"
              className={AUTH_INPUT_CLASS_NAME}
              required
            />
            <Input
              id="register-confirm-password"
              type="password"
              autoComplete="new-password"
              value={authConfirmPassword}
              onChange={(event) => onConfirmPasswordChange(event.target.value)}
              placeholder="Confirm password"
              className={AUTH_INPUT_CLASS_NAME}
              required
            />
            {authError && <p className="break-words font-mono text-caption text-danger-foreground">{authError}</p>}
            <div className="w-full pt-2">
              <Button type="submit" disabled={isSigningIn} className={AUTH_SUBMIT_CLASS_NAME}>
                {isSigningIn ? "Creating Account..." : "Register"}
              </Button>
            </div>
          </form>
        )}

        <div className="flex h-inset-lg w-full items-start justify-center">
          <Button variant="unstyled"
            type="button"
            className="font-mono text-label font-normal uppercase leading-label tracking-label-lg text-muted-foreground"
            onClick={switchAuthMode}
          >
            {isForgotPasswordMode
              ? "Back to Sign In"
              : isLoginMode
                ? "Need an account? Register"
                : "Already have an account? Sign In"}
          </Button>
        </div>
      </section>
    </main>
  );
}
