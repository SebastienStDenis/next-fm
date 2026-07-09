import { type ReactNode } from "react";

// Standard container for missing-data messages (see docs/wording.md): a
// dashed placeholder box where the list content will eventually appear.
export function EmptyState({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={`rounded border border-dashed border-gray-300 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 ${className ?? ""}`}
    >
      {children}
    </p>
  );
}
