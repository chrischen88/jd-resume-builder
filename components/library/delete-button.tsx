"use client";

import { deleteDocument } from "@/app/library/actions";

export function DeleteButton({ id, title }: { id: string; title: string }) {
  return (
    <form
      action={deleteDocument}
      onSubmit={(event) => {
        if (!window.confirm(`Delete “${title}” from the library?`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={`Delete ${title}`}
        className="rounded px-2 py-1 text-xs text-muted hover:bg-danger-soft hover:text-danger"
      >
        Delete
      </button>
    </form>
  );
}
