"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Toast, ToastKind } from "@/types/workspace";

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutIdsRef = useRef<number[]>([]);

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((previousToasts) => [...previousToasts, { id, kind, message }]);

    const timeoutId = window.setTimeout(() => {
      setToasts((previousToasts) => previousToasts.filter((toast) => toast.id !== id));
      timeoutIdsRef.current = timeoutIdsRef.current.filter((activeTimeoutId) => activeTimeoutId !== timeoutId);
    }, 2600);

    timeoutIdsRef.current.push(timeoutId);
  }, []);

  useEffect(() => {
    return () => {
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  return { toasts, pushToast };
}
