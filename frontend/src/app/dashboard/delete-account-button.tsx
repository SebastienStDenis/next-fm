"use client";

import { useActionState } from "react";

import { deleteAccount } from "./actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function DeleteAccountButton({ userName }: { userName: string }) {
  const [state, formAction, pending] = useActionState(deleteAccount, {
    error: null,
  });

  return (
    <div className="text-right">
      {/* The confirm button lives in a portal, outside this element; it
          submits via form="delete-account". */}
      <form id="delete-account" action={formAction} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" size="sm" disabled={pending}>
            {pending && <Spinner />}
            Delete account
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {userName}&apos;s account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account, playlists, and data. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              type="submit"
              form="delete-account"
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {state.error && (
        <p className="mt-2 text-sm text-destructive">{state.error}</p>
      )}
    </div>
  );
}
