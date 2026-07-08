"use client";

import { useActionState } from "react";

import { changeEmail } from "./actions";

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, pending] = useActionState(changeEmail, {
    error: null,
    success: null,
  });

  return (
    <form action={formAction} className="space-y-3">
      <p className="text-sm text-gray-500">
        Current: <span className="text-foreground">{currentEmail}</span>
      </p>
      <input
        name="email"
        type="email"
        placeholder="New email"
        required
        autoComplete="email"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Sending..." : "Change email"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
