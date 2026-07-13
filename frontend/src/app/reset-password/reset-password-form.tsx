"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { resetPassword } from "./actions";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Punish late: the mismatch hint waits for the confirm field's first
  // blur, then revalidates live so it clears as soon as the fields agree.
  // Clearing the field starts the attempt over, grace period included.
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [state, formAction, pending] = useActionState(resetPassword, {
    error: null,
  });

  const mismatch =
    confirmationTouched && confirmation !== "" && confirmation !== password;
  const valid = password.length >= 6 && confirmation === password;

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">At least 6 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => {
            setConfirmation(e.target.value);
            if (e.target.value === "") {
              setConfirmationTouched(false);
            }
          }}
          onBlur={() => setConfirmationTouched(true)}
        />
        {mismatch && (
          <p className="text-xs text-destructive">Passwords do not match.</p>
        )}
      </div>
      {state.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      <Button type="submit" disabled={pending || !valid} className="w-full">
        {pending && <Spinner />}
        Set new password
      </Button>
    </form>
  );
}
