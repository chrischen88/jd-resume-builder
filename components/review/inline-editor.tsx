"use client";

import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { useRef, useState, useTransition } from "react";

import type { SaveResult } from "@/app/target-sets/[id]/review/actions";

// Screen 7 (task 1.26): one line of resume text, edited in place with TipTap.
// Plain text only (one paragraph, no formatting), so what's saved is what an
// ATS reads. Saves on Enter or when focus leaves; Escape puts it back.

/** One paragraph, nothing else. */
const OneParagraph = Document.extend({ content: "paragraph" });

/** Content built from the text itself, never parsed as HTML. */
function toDoc(text: string): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  };
}

export function InlineEditor({
  value,
  label,
  placeholder = "",
  save,
  className = "",
}: {
  value: string;
  /** Screen-reader name, e.g. "Bullet: Built reports". */
  label: string;
  placeholder?: string;
  /** A Server Action bound to what's being edited. */
  save: (text: string) => Promise<SaveResult>;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const saved = useRef(value);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [OneParagraph, Paragraph, Text, UndoRedo, Placeholder.configure({ placeholder })],
    content: toDoc(value),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": label,
        "aria-multiline": "false",
        class:
          "rounded px-1 -mx-1 outline-none hover:bg-surface focus:bg-surface focus:ring-2 focus:ring-accent",
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          view.dom.blur();
          return true;
        }
        if (event.key === "Escape") {
          const { state } = view;
          const end = state.doc.content.size - 1;
          view.dispatch(
            saved.current ? state.tr.insertText(saved.current, 1, end) : state.tr.delete(1, end),
          );
          setError(null);
          view.dom.blur();
          return true;
        }
        return false;
      },
      // Pasted text becomes one line of plain text.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        view.dispatch(view.state.tr.insertText(text.replace(/\s+/g, " ")));
        return true;
      },
    },
    onBlur: ({ editor }) => {
      const text = editor.getText().replace(/\s+/g, " ").trim();
      if (text === saved.current) return;
      startTransition(async () => {
        const result = await save(text);
        setError(result.error);
        if (!result.error) saved.current = text;
      });
    },
  });

  return (
    <span className={`block ${className}`}>
      {editor ? (
        <EditorContent editor={editor} aria-busy={pending} />
      ) : (
        // Before the editor loads (and without JavaScript), the text itself.
        <span className="block px-1 -mx-1">{value}</span>
      )}
      {pending && <span className="block text-xs text-muted">Saving…</span>}
      {error && (
        <span role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
