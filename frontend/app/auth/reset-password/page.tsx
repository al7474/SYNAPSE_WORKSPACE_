"use client";

import { Heading } from "@/components/ui/heading";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetPassword } from "@/lib/session";

const INPUT_CLASS_NAME =
  "h-control min-w-0 rounded-none border-overlay/10 bg-transparent px-inset-lg py-inset font-mono text-caption font-normal leading-normal text-muted-foreground placeholder:text-muted-foreground focus-visible:ring-0";
const SUBMIT_CLASS_NAME =
  "h-control w-full rounded-none border border-overlay/10 bg-transparent px-inset-lg py-inset font-mono text-caption font-normal uppercase leading-4 tracking-caps text-foreground shadow-none hover:bg-overlay/5";

function readAndClearActionToken(): string {
  const url = new URL(window.location.href);
  const fragmentParameters = new URLSearchParams(url.hash.slice(1));
  const fragmentToken = fragmentParameters.get("token")?.trim() || "";
  const token = fragmentToken;

  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
  }

  if (fragmentParameters.has("token")) {
    fragmentParameters.delete("token");
    const nextHash = fragmentParameters.toString();
    url.hash = nextHash ? `#${nextHash}` : "";
  }

  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, document.title, url.toString());
  }

  return token;
}

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    setToken(readAndClearActionToken());
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("This reset link is missing its token.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);

    try {
      await resetPassword(token, password);
      setIsComplete(true);
      setPassword("");
      setConfirmPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to reset password");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-bright">
      <section className="flex w-full max-w-auth-card flex-col gap-6 border border-overlay/10 bg-card-translucent/40 p-10">
        <div>
          <p className="font-mono text-label uppercase tracking-label-lg text-muted-foreground">Synapse Workspace</p>
          <Heading level={1} className="pt-3 font-sans text-heading font-normal leading-7 text-foreground">
            {isComplete ? "Password updated" : "Reset your password"}
          </Heading>
          <p className="pt-3 font-mono text-caption leading-5 text-muted-foreground">
            {isComplete
              ? "Your existing account sessions were signed out. You can now sign in with the new password."
              : "Choose a new password for your Synapse Workspace account."}
          </p>
        </div>

        {isComplete ? (
          <Link href="/" className="w-full">
            <Button className={SUBMIT_CLASS_NAME}>Return to Sign In</Button>
          </Link>
        ) : (
          <form className="flex w-full flex-col gap-4" onSubmit={handleSubmit}>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              className={INPUT_CLASS_NAME}
              required
            />
            <Input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              className={INPUT_CLASS_NAME}
              required
            />
            {error && <p className="break-words font-mono text-caption text-danger-foreground">{error}</p>}
            <Button type="submit" disabled={isSubmitting} className={SUBMIT_CLASS_NAME}>
              {isSubmitting ? "Updating..." : "Update Password"}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}