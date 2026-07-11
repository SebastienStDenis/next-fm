"use client";

import { useActionState } from "react";

import { deleteAccount } from "./actions";
import { Spinner } from "../spinner";

export function DeleteAccountButton({ userName }: { userName: string }) {
  const [state, formAction, pending] = useActionState(deleteAccount, {
    error: null,
  });

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !window.confirm(`Delete ${userName}'s account? This cannot be undone.`)
        ) {
          event.preventDefault();
        }
      }}
      className="text-right"
    >
      <button
        type="submit"
        disabled={pending}
        className="relative rounded border border-red-600 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
      >
        {/* Kept in the layout (just hidden) while pending so the button holds
            the same width as when it reads "Delete account". */}
        <span className={pending ? "invisible" : undefined}>
          Delete account
        </span>
        {/* The button's red text would tint the spinner like an error; spin
            in neutral gray instead. */}
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center text-gray-500">
            <Spinner />
          </span>
        )}
      </button>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
