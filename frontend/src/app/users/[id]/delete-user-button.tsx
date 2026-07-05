"use client";

import { useActionState } from "react";

import { deleteUser } from "./actions";

export function DeleteUserButton({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [state, formAction, pending] = useActionState(
    deleteUser.bind(null, userId),
    { error: null },
  );

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${userName}? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
      className="text-right"
    >
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
      >
        {pending ? "Deleting..." : "Delete user"}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
