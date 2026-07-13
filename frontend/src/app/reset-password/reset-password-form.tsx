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
  // Punish late: the mismatch hint never judges the confirmation while
  // it's being edited, only once the user leaves the field. The submit
  // button enabling still gives live match feedback.
  const [confirmationFocused, setConfirmationFocused] = useState(false);
  const [state, formAction, pending] = useActionState(resetPassword, {
    error: null,
  });

  const mismatch =
    !confirmationFocused && confirmation !== "" && confirmation !== password;
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
          onChange={(e) => setConfirmation(e.target.value)}
          onFocus={() => setConfirmationFocused(true)}
          onBlur={() => setConfirmationFocused(false)}
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
