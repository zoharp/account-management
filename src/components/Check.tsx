'use client';

/**
 * A checkbox with its consequence written next to it.
 *
 * Every flag on these tabs turns something off for a real customer, and the
 * label alone never says what. Shared across the Traceability and Ask Paul tabs
 * so the two read identically — they were separate copies while both lived in
 * one dialog.
 */
export default function Check({
  label,
  hint,
  checked,
  onChange,
  disabled,
  disabledReason,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Only ever used to stop a flag being turned ON — see the Ask Paul tab. */
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <label className="acl-check" title={disabled ? disabledReason : undefined}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <em>{hint}</em>
      </span>
    </label>
  );
}
