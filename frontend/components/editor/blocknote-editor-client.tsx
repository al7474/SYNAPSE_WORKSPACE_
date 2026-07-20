"use client";

import { useEffect, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

type BlockNoteEditorClientProps = {
  noteId: string;
  markdown: string;
  editable: boolean;
  onMarkdownChange: (markdown: string) => void;
};

export function BlockNoteEditorClient({
  noteId,
  markdown,
  editable,
  onMarkdownChange,
}: BlockNoteEditorClientProps) {
  const editor = useCreateBlockNote();
  const applyingExternalContentRef = useRef(false);
  const lastAppliedMarkdownRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const source = markdown?.trim().length ? markdown : " ";

      if (lastAppliedMarkdownRef.current === source) {
        return;
      }

      applyingExternalContentRef.current = true;
      const parsed = await editor.tryParseMarkdownToBlocks(source);

      if (cancelled) {
        return;
      }

      const currentBlockIds = editor.document.map((block) => block.id);

      if (currentBlockIds.length > 0 && parsed.length > 0) {
        editor.replaceBlocks(currentBlockIds, parsed);
      }

      lastAppliedMarkdownRef.current = source;
      applyingExternalContentRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, markdown, noteId]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={() => {
        if (applyingExternalContentRef.current) {
          return;
        }

        void (async () => {
          const serialized = await editor.blocksToMarkdownLossy(editor.document);
          lastAppliedMarkdownRef.current = serialized;
          onMarkdownChange(serialized);
        })();
      }}
    />
  );
}
