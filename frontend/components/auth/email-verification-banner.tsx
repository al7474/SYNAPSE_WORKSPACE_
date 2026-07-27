"use client";

import { MailCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type EmailVerificationBannerProps = {
  email: string | null;
  error: string;
  isSubmitting: boolean;
  onResend: () => void | Promise<void>;
  onCheck: () => void | Promise<void>;
};

export function EmailVerificationBanner({
  email,
  error,
  isSubmitting,
  onResend,
  onCheck,
}: EmailVerificationBannerProps) {
  return (
    <aside
      className="border-b border-[rgba(255,255,255,0.1)] bg-[#171717] px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MailCheck size={16} className="mt-0.5 shrink-0 text-[#f6c453]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.55px] text-[#fafafa]">
              Email verification pending
            </p>
            <p className="mt-1 text-[11px] leading-5 text-[#a1a1a1]">
              {email ? `Verify ${email} to unlock sharing and collaborator access.` : "Verify your email to unlock sharing and collaborator access."}
              {" "}Private boards and notes remain available.
            </p>
            {error && <p className="mt-1 break-words text-[11px] text-red-300">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          <Button
            type="button"
            disabled={isSubmitting}
            className="h-8 rounded-none border border-[rgba(255,255,255,0.15)] bg-transparent px-3 py-1.5 text-[10px] uppercase tracking-[0.45px] text-[#fafafa] shadow-none hover:bg-[#262626]"
            onClick={() => void onCheck()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {isSubmitting ? "Checking..." : "Check status"}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            className="h-8 rounded-none border border-[rgba(246,196,83,0.45)] bg-transparent px-3 py-1.5 text-[10px] uppercase tracking-[0.45px] text-[#f6c453] shadow-none hover:bg-[rgba(246,196,83,0.08)]"
            onClick={() => void onResend()}
          >
            {isSubmitting ? "Sending..." : "Resend email"}
          </Button>
        </div>
      </div>
    </aside>
  );
}