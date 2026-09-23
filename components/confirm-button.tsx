"use client";

/** A form with one button that asks before submitting (for deletes). */
export function ConfirmButton({
  action,
  fields,
  message,
  label,
  ariaLabel,
  className = "rounded px-2 py-1 text-xs text-muted hover:bg-danger-soft hover:text-danger",
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  message: string;
  label: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" aria-label={ariaLabel} className={className}>
        {label}
      </button>
    </form>
  );
}
