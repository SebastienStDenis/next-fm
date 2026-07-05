"use client";

import { useActionState } from "react";

import { createUser } from "./actions";

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUser, {
    error: null,
  });

  return (
    <form action={formAction} className="mb-6 space-y-2">
      <div className="flex gap-2">
        <input
          name="name"
          placeholder="Name"
          required
          className="flex-1 rounded border border-gray-300 bg-transparent px-3 py-2 dark:border-gray-700"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add user"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
