"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";

type DeleteDemoWorkspaceDialogProps = {
  open: boolean;
  isDeleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function DeleteDemoWorkspaceDialog({
  open,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: DeleteDemoWorkspaceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto border border-overlay/10 bg-card p-0 text-foreground shadow-2xl backdrop:bg-background/80"
      aria-labelledby="delete-demo-workspace-title"
      aria-describedby="delete-demo-workspace-description"
      onCancel={(event) => {
        event.preventDefault();

        if (!isDeleting) {
          onCancel();
        }
      }}
    >
      <div className="p-6">
        <Heading
          level={2}
          id="delete-demo-workspace-title"
          className="text-sm text-foreground"
        >
          Delete this demo workspace?
        </Heading>
        <p
          id="delete-demo-workspace-description"
          className="mt-2 text-sm text-muted-foreground"
        >
          Deleting this temporary demo workspace permanently removes all of its boards and notes.
          This action cannot be undone.
        </p>

        {error && (
          <p role="alert" className="mt-4 border border-danger/30 px-3 py-2 text-label text-danger-foreground">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isDeleting} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
