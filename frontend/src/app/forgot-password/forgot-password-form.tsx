"use client";

import { useActionState } from "react";

import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {
    error: null,
  });

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
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Sending..." : "Send reset link"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
