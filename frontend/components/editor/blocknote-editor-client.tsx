"use client";

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
    const checklistMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);

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
      const parsed = await editor.tryParseMarkdownToBlocks(source);
      const containsChecklist = /^\s*[-*]\s+\[[ xX]\]\s+/m.test(source);
      const blocks: PartialBlock[] =
        containsChecklist && !parsed.some((block) => block.type === "checkListItem")
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
      <div className="flex items-center justify-between border-b border-[#484848] bg-[#151515] px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.4px] text-[#8f8f8f]">Note content</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 border border-[#484848] px-2.5 py-1.5 text-xs text-[#d6d6d6] transition-colors hover:border-[#8a8a8a] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
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
        </button>
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
