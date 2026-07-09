"use client";

import { useRouter } from "next/navigation";

export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        // Mirror the browser back button so the dashboard reopens on the tab
        // the user left (its ?tab= URL is in history). Fall back when this
        // page was loaded directly, with no history to return to.
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className="cursor-pointer text-sm text-gray-500 hover:underline"
    >
      &larr; Back
    </button>
  );
}
