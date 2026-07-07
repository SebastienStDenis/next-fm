"use client";

// Eye glyphs stand in for the ignore/undo actions everywhere. The crossed-out
// eye (eye + combining enclosing circle-backslash) hides an item; the plain eye
// brings it back.
const HIDE_ICON = "\u{1F441}\u{FE0F}\u{20E0}";
const SHOW_ICON = "\u{1F441}\u{FE0F}";

export function IgnoreButton({
  ignored,
  onClick,
  disabled,
}: {
  ignored: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const label = ignored ? "Show again" : "Ignore";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="ml-auto text-base leading-none hover:opacity-70 disabled:opacity-40"
    >
      {ignored ? SHOW_ICON : HIDE_ICON}
    </button>
  );
}
