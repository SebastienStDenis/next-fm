// Pencil mark used for edit icon buttons; colored by the parent's text color.
export function PencilMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m11 3 2 2-7.5 7.5L2.5 13.5l1-3z" />
    </svg>
  );
}
