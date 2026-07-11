"use client";

import { useActionState } from "react";

import { logIn } from "./actions";
import { Spinner } from "../spinner";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(logIn, { error: null });

  return (
    <form action={formAction} className="space-y-3">
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        autoComplete="email"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        autoComplete="current-password"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="relative w-full rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        <span className={pending ? "invisible" : undefined}>Log in</span>
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </span>
        )}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
