"use client";

import { useActionState, useState } from "react";
import { Check } from "lucide-react";

import { Collapse } from "../collapse";
import { FormError } from "../form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { resetPassword } from "./actions";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Punish late, revalidate eagerly: the mismatch hint waits for the
  // confirm field's first blur, then tracks every edit until resolved.
  // An empty field shows nothing - it makes no mismatch claim yet.
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
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          At least 6 characters.
          <Check
            aria-hidden
            className={cn(
              "size-3 text-green-600 transition-opacity duration-300 dark:text-green-500",
              password.length >= 6 ? "opacity-100" : "opacity-0",
            )}
            strokeWidth={2.5}
          />
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <div>
          <Input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            onBlur={() => setConfirmationTouched(true)}
          />
          <Collapse show={mismatch}>
            <p className="pt-2 text-xs text-destructive">
              Passwords do not match.
            </p>
          </Collapse>
        </div>
      </div>
      <div className="grid">
        <Collapse show={state.error !== null}>
          <FormError className="pb-3">{state.error}</FormError>
        </Collapse>
        <Button type="submit" disabled={pending || !valid} className="w-full">
          {pending && <Spinner />}
          Set new password
        </Button>
      </div>
    </form>
  );
}
