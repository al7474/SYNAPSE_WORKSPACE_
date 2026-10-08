"use client";

import { Heading } from "@/components/ui/heading";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { verifyEmail } from "@/lib/session";

type VerificationState = "loading" | "success" | "error";

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

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerificationState>("loading");
  const [message, setMessage] = useState("Verifying your email...");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    const token = readAndClearActionToken();

    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }

    void verifyEmail(token)
      .then((result) => {
        setState("success");
        setMessage(`Email verified for ${result.user.email}.`);
      })
      .catch((error) => {
        setState("error");
        setMessage(error instanceof Error ? error.message : "Unable to verify email");
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-bright">
      <section className="flex w-full max-w-auth-card flex-col gap-6 border border-overlay/10 bg-card-translucent/40 p-10">
        <div>
          <p className="font-mono text-label uppercase tracking-label-lg text-muted-foreground">Synapse Workspace</p>
          <Heading level={1} className="pt-3 font-sans text-heading font-normal leading-7 text-foreground">
            {state === "success" ? "Email verified" : state === "error" ? "Verification unavailable" : "Verify your email"}
          </Heading>
          <p className="pt-3 font-mono text-caption leading-5 text-muted-foreground" aria-live="polite">
            {message}
          </p>
        </div>

        <Link href="/" className="w-full">
          <Button className="h-control w-full rounded-none border border-overlay/10 bg-transparent font-mono text-caption uppercase tracking-caps text-foreground shadow-none hover:bg-overlay/5">
            {state === "success" ? "Return to Workspace" : "Back to Sign In"}
          </Button>
        </Link>
      </section>
    </main>
  );
}