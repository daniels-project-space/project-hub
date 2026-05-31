"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Click-to-edit inline value. Commits on blur or Enter; cancels on Escape.
export function EditableValue({
  value,
  onCommit,
  placeholder = "—",
  className,
  inputClassName,
  multiline = false,
  type = "text",
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  type?: "text" | "number";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    const shared = {
      ref: inputRef as never,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      className: cn(
        "w-full bg-ink-2/80 border border-brass/40 rounded px-2 py-1 text-paper outline-none",
        inputClassName,
      ),
    };
    if (multiline) {
      return (
        <textarea
          {...shared}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          }}
        />
      );
    }
    return (
      <input
        {...shared}
        type={type}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") cancel();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "text-left hover:bg-paper/[0.04] rounded px-1 -mx-1 transition-colors",
        !value && "text-paper-faint",
        className,
      )}
    >
      {value || placeholder}
    </button>
  );
}
