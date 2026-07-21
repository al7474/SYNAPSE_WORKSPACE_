"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SessionLoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Synapse Workspace</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Initializing secure workspace environment...</p>
        </CardContent>
      </Card>
    </main>
  );
}
