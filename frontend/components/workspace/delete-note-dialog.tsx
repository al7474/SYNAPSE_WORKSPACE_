"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DeleteNoteDialogProps = {
  open: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function DeleteNoteDialog({ open, isDeleting, onCancel, onConfirm }: DeleteNoteDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
      <Card className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto">
        <CardHeader>
          <CardTitle>Delete this note?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">This action removes the note permanently.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void onConfirm()} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Confirm delete"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
