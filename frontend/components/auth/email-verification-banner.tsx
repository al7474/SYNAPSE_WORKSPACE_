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
      className="border-b border-overlay/10 bg-card px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-shell flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <MailCheck size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-label uppercase tracking-label-lg text-foreground">
              Email verification pending
            </p>
            <p className="mt-1 text-label leading-5 text-muted-foreground">
              {email
                ? `We sent a verification email to ${email}. Verify it to unlock sharing and collaborator access, or continue using private boards and notes without verifying.`
                : "We sent a verification email. Verify it to unlock sharing and collaborator access, or continue using private boards and notes without verifying."}
            </p>
            {error && <p className="mt-1 break-words text-label text-danger-foreground">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          <Button
            type="button"
            disabled={isSubmitting}
            className="h-8 rounded-none border border-overlay/15 bg-transparent px-3 py-1.5 text-micro uppercase tracking-label text-foreground shadow-none hover:bg-secondary"
            onClick={() => void onCheck()}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {isSubmitting ? "Checking..." : "Check status"}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            className="h-8 rounded-none border border-warning/45 bg-transparent px-3 py-1.5 text-micro uppercase tracking-label text-warning shadow-none hover:bg-warning/8"
            onClick={() => void onResend()}
          >
            {isSubmitting ? "Sending..." : "Resend email"}
          </Button>
        </div>
      </div>
    </aside>
  );
}