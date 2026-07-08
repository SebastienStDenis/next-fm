"use client";

import { useActionState } from "react";

import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, {
    error: null,
    success: null,
  });

  return (
    <form action={formAction} className="space-y-3">
      <input
        name="password"
        type="password"
        placeholder="New password"
        required
        minLength={6}
        autoComplete="new-password"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <input
        name="confirm"
        type="password"
        placeholder="Confirm new password"
        required
        minLength={6}
        autoComplete="new-password"
        className="w-full rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        {pending ? "Updating..." : "Update password"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
