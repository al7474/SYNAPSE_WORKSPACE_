"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthMode } from "@/types/workspace";

const GUEST_ACCESS_ICON_URL = "https://www.figma.com/api/mcp/asset/94931bfe-7097-4580-b779-eeb53f4c0f0e";

const AUTH_INPUT_CLASS_NAME =
  "h-[42px] min-w-0 rounded-none border-white/10 bg-transparent px-[17px] py-[13px] font-mono text-[12px] font-normal leading-normal text-[#a1a1a1] placeholder:text-[#a1a1a1] focus-visible:ring-0";
const AUTH_SUBMIT_CLASS_NAME =
  "h-[42px] w-full rounded-none border border-white/10 bg-transparent px-[17px] py-[13px] font-mono text-[12px] font-normal uppercase leading-4 tracking-[0.6px] text-[#fafafa] shadow-none hover:bg-white/5";

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
    <main className="flex min-h-screen items-center justify-center overflow-y-auto bg-[#0a0a0a] px-4 py-8 text-white">
      <section className="flex w-full max-w-[448px] flex-col gap-7 border border-white/10 bg-[rgba(23,23,23,0.4)] p-10">
        <header className="flex h-[133px] w-full shrink-0 flex-col items-center">
          <div className="grid h-16 w-16 place-items-center border border-white/10 bg-[#262626]">
            <span className="w-[45px] text-center font-sans text-[11px] font-medium leading-[14px] text-[#a1a1a1]">
              Synapse
            </span>
          </div>
          <div className="pt-5">
            <h1 className="font-sans text-[18px] font-normal leading-7 text-[#fafafa]">Synapse Workspace</h1>
          </div>
          <div className="pt-1">
            <p className="font-mono text-[11px] font-normal uppercase leading-[16.5px] tracking-[0.55px] text-[#a1a1a1]">
              {isLoginMode
                ? "Sign in to continue"
                : isForgotPasswordMode
                  ? "Recover your account"
                  : "Create your account"}
            </p>
          </div>
        </header>

        <div className="border border-emerald-400/20 bg-emerald-400/[0.04] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] font-normal uppercase tracking-[0.55px] text-emerald-300">
              Demo mode
            </span>
            <span className="font-mono text-[10px] font-normal uppercase tracking-[0.45px] text-[#a1a1a1]">
              No account required
            </span>
          </div>
          <p className="pt-1 font-mono text-[11px] font-normal leading-[16.5px] text-[#a1a1a1]">
            Temporary workspace for exploring Synapse.
          </p>
        </div>

        <Button
          data-testid="enter-demo"
          className="h-[52px] min-h-0 w-full rounded-none bg-[#e5e5e5] px-4 pb-4 pt-5 font-mono text-[12px] font-normal uppercase tracking-[0.6px] text-[#171717] shadow-none hover:bg-[#e5e5e5]"
          onClick={onGuestAccess}
          disabled={isSigningIn}
        >
          <img src={GUEST_ACCESS_ICON_URL} alt="" aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="text-center leading-[15px]">{isSigningIn ? "Starting Demo..." : "Enter Demo Mode"}</span>
        </Button>

        <div className="flex h-[17px] w-full items-center gap-3 font-mono text-[11px] font-normal leading-[16.5px] text-[#a1a1a1]">
          <div className="h-px min-w-0 flex-1 bg-white/10" />
          <span className="shrink-0 uppercase tracking-[0.55px]">Account mode</span>
          <div className="h-px min-w-0 flex-1 bg-white/10" />
        </div>

        {isForgotPasswordMode ? (
          <form id="account-auth-form" className="flex w-full flex-col gap-4" onSubmit={onForgotPassword}>
            <p className="font-mono text-[11px] leading-[16.5px] text-[#a1a1a1]">
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
            {authError && <p className="break-words font-mono text-[12px] text-red-300">{authError}</p>}
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
            {authError && <p className="break-words font-mono text-[12px] text-red-300">{authError}</p>}
            <div className="w-full pt-2">
              <Button type="submit" disabled={isSigningIn} className={AUTH_SUBMIT_CLASS_NAME}>
                {isSigningIn ? "Signing In..." : "Sign In"}
              </Button>
            </div>
            <button
              type="button"
              className="font-mono text-[11px] font-normal uppercase leading-[16.5px] tracking-[0.55px] text-[#a1a1a1]"
              onClick={openForgotPassword}
            >
              Forgot password?
            </button>
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
            {authError && <p className="break-words font-mono text-[12px] text-red-300">{authError}</p>}
            <div className="w-full pt-2">
              <Button type="submit" disabled={isSigningIn} className={AUTH_SUBMIT_CLASS_NAME}>
                {isSigningIn ? "Creating Account..." : "Register"}
              </Button>
            </div>
          </form>
        )}

        <div className="flex h-[17px] w-full items-start justify-center">
          <button
            type="button"
            className="font-mono text-[11px] font-normal uppercase leading-[16.5px] tracking-[0.55px] text-[#a1a1a1]"
            onClick={switchAuthMode}
          >
            {isForgotPasswordMode
              ? "Back to Sign In"
              : isLoginMode
                ? "Need an account? Register"
                : "Already have an account? Sign In"}
          </button>
        </div>
      </section>
    </main>
  );
}
