"use client";

import { useTransition } from "react";

import { signOut } from "./actions";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => signOut())}>
      <button
        type="submit"
        disabled={pending}
        className="text-sm text-gray-500 hover:underline disabled:opacity-50"
      >
        {pending ? "Signing out..." : "Sign out"}
      </button>
    </form>
  );
}
