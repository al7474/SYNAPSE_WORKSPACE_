"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { Toast } from "@/types/workspace";

type ToastViewportProps = {
  toasts: Toast[];
};

export function ToastViewport({ toasts }: ToastViewportProps) {
  return (
    <div className="fixed right-4 top-4 grid w-[min(340px,calc(100%-24px))] gap-2">
      {toasts.map((toast) => (
        <Card
          key={toast.id}
          className={
            toast.kind === "success"
              ? "border-emerald-500/40"
              : toast.kind === "error"
                ? "border-destructive/50"
                : "border-primary/40"
          }
        >
          <CardContent className="p-3 text-sm">{toast.message}</CardContent>
        </Card>
      ))}
    </div>
  );
}
