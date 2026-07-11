// X mark used for destructive icon buttons and failed states; colored by the
// parent's text color.
export function XMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="m4.5 4.5 7 7m0-7-7 7" />
    </svg>
  );
}
