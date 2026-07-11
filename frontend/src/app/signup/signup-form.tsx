"use client";

import { useActionState } from "react";

import { signUp } from "./actions";
import { Spinner } from "../spinner";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, { error: null });

  return (
    <form action={formAction} className="space-y-3">
      <input
        name="name"
        placeholder="Name"
        required
        autoComplete="name"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
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
        minLength={6}
        autoComplete="new-password"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="relative w-full rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        <span className={pending ? "invisible" : undefined}>Sign up</span>
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
