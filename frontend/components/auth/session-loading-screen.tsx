"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SessionLoadingScreenProps = {
  error?: string;
  isWaking?: boolean;
  elapsedSeconds?: number;
  status?: string;
  onRetry?: () => void;
};

export function SessionLoadingScreen({
  error,
  isWaking,
  elapsedSeconds = 0,
  status,
  onRetry,
}: SessionLoadingScreenProps) {
  const wakingMessage = isWaking
    ? `The demo server is waking up. This usually takes up to 30 seconds on the free hosting tier. (${elapsedSeconds}s elapsed)`
    : undefined;

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Synapse Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {error ?? wakingMessage ?? "Initializing secure workspace environment..."}
          </p>
          {status && status !== wakingMessage ? (
            <p className="sr-only" role="status" aria-live="polite">
              {status}
            </p>
          ) : null}
          {error && onRetry ? (
            <Button variant="unstyled"
              type="button"
              className="mt-4 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={onRetry}
            >
              Retry connection
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
