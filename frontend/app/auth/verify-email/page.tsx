"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { verifyEmail } from "@/lib/session";

type VerificationState = "loading" | "success" | "error";

function readAndClearActionToken(): string {
  const url = new URL(window.location.href);
  const fragmentParameters = new URLSearchParams(url.hash.slice(1));
  const queryToken = url.searchParams.get("token")?.trim() || "";
  const fragmentToken = fragmentParameters.get("token")?.trim() || "";
  const token = fragmentToken || queryToken;

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
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-8 text-white">
      <section className="flex w-full max-w-[448px] flex-col gap-6 border border-white/10 bg-[rgba(23,23,23,0.4)] p-10">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.55px] text-[#a1a1a1]">Synapse Workspace</p>
          <h1 className="pt-3 font-sans text-[22px] font-normal leading-7 text-[#fafafa]">
            {state === "success" ? "Email verified" : state === "error" ? "Verification unavailable" : "Verify your email"}
          </h1>
          <p className="pt-3 font-mono text-[12px] leading-5 text-[#a1a1a1]" aria-live="polite">
            {message}
          </p>
        </div>

        <Link href="/" className="w-full">
          <Button className="h-[42px] w-full rounded-none border border-white/10 bg-transparent font-mono text-[12px] uppercase tracking-[0.6px] text-[#fafafa] shadow-none hover:bg-white/5">
            {state === "success" ? "Return to Workspace" : "Back to Sign In"}
          </Button>
        </Link>
      </section>
    </main>
  );
}