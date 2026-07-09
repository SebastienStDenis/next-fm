"use client";

import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => {
        // Mirror the browser back button so the dashboard reopens on the tab
        // the user left (its ?tab= URL is in history). Fall back to the
        // dashboard root when settings was loaded directly, with no history.
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push("/dashboard");
        }
      }}
      className="cursor-pointer text-sm text-gray-500 hover:underline"
    >
      &larr; Back
    </button>
  );
}
