"use client";

import { useTransition } from "react";

import { signOut } from "./actions";
import { Spinner } from "../spinner";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <form action={() => startTransition(() => signOut())}>
      <button
        type="submit"
        disabled={pending}
        className="relative text-sm text-gray-500 hover:underline disabled:opacity-50"
      >
        <span className={pending ? "invisible" : undefined}>Sign out</span>
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
      </button>
    </form>
  );
}
