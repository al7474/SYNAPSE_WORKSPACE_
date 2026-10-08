"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SessionLoadingScreenProps = {
  error?: string;
  onRetry?: () => void;
};

export function SessionLoadingScreen({ error, onRetry }: SessionLoadingScreenProps) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Synapse Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {error ?? "Initializing secure workspace environment..."}
          </p>
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
