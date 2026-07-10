// Unfold marker: chevrons point away from each other when collapsed (expand)
// and toward each other when open (collapse). Toggled by the parent
// <details className="group"> via the group-open state.
export function ExpandToggleMark() {
  return (
    <span className="ml-0.5 text-gray-400 dark:text-gray-600">
      <svg
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5 group-open:hidden"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 6.5 8 3.5 11 6.5" />
        <path d="M5 9.5 8 12.5 11 9.5" />
      </svg>
      <svg
        viewBox="0 0 16 16"
        className="hidden h-3.5 w-3.5 group-open:block"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 3.5 8 6.5 11 3.5" />
        <path d="M5 12.5 8 9.5 11 12.5" />
      </svg>
    </span>
  );
}
