"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useRef } from "react";
import { ListChecks } from "lucide-react";
import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

type BlockNoteEditorClientProps = {
  noteId: string;
  markdown: string;
  editable: boolean;
  onMarkdownChange: (markdown: string) => void;
};

function parseChecklistFallback(markdown: string): PartialBlock[] {
  return markdown.split(/\r?\n/).map((line) => {
    const checklistMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s*(.*)$/);

    if (checklistMatch) {
      return {
        type: "checkListItem",
        props: { checked: checklistMatch[1].toLowerCase() === "x" },
        content: checklistMatch[2],
      };
    }

    return { type: "paragraph", content: line };
  });
}

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
      const containsChecklist = /\[[ xX]\]/.test(source);
      const parsed = containsChecklist ? [] : await editor.tryParseMarkdownToBlocks(source);
      const blocks: PartialBlock[] =
        containsChecklist
          ? parseChecklistFallback(source)
          : parsed.length > 0
            ? parsed
            : [{ type: "paragraph" as const, content: "" }];

      if (cancelled) {
        return;
      }

      const currentBlockIds = editor.document.map((block) => block.id);

      if (currentBlockIds.length > 0) {
        editor.replaceBlocks(currentBlockIds, blocks);
      }

      lastAppliedMarkdownRef.current = source;
      applyingExternalContentRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [editor, markdown, noteId]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border-strong bg-surface-sunken px-3 py-2">
        <span className="text-label uppercase tracking-label-xs text-neutral-soft">Note content</span>
        <Button variant="unstyled"
          type="button"
          className="inline-flex items-center gap-1.5 border border-border-strong px-2.5 py-1.5 text-xs text-soft transition-colors hover:border-neutral-strong hover:text-bright disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            const lastBlock = editor.document[editor.document.length - 1];

            if (!lastBlock) {
              return;
            }

            const [taskBlock] = editor.insertBlocks(
              [{ type: "checkListItem", content: "" }],
              lastBlock.id,
              "after"
            );
            editor.setTextCursorPosition(taskBlock.id, "start");
          }}
          disabled={!editable}
          title="Add a checklist task"
        >
          <ListChecks size={14} aria-hidden="true" />
          Add task
        </Button>
      </div>
      <div className="min-h-0 flex-1">
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
      </div>
    </div>
  );
}
