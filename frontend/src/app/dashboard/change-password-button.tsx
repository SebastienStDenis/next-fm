"use client";

import { useActionState, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";

import { changePassword } from "./actions";
import type { ActionState } from "./actions";
import { Collapse } from "../collapse";
import { FormError } from "../form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  // Bumped on each open so the form remounts fresh: field state and the
  // useActionState error (which has no reset) don't linger from a prior open.
  const [session, setSession] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setSession((n) => n + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Change password"
          title="Change password"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
        </DialogHeader>
        <ChangePasswordForm key={session} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Punish late, revalidate eagerly: the requirement mark and mismatch hint
  // wait for their field's first blur with content, then track every edit
  // until resolved. Blurring an empty field makes no claim, so it leaves the
  // grace period intact instead of spending it while passing through.
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changePassword(prev, formData);
      // On success close the dialog and confirm with a toast.
      if (!result.error) {
        onDone();
        toast.success("Password changed.");
      }
      return result;
    },
    { error: null },
  );

  const passwordMet = password.length >= 6;
  const passwordUnmet = passwordTouched && password !== "" && !passwordMet;
  const mismatch =
    confirmationTouched && confirmation !== "" && confirmation !== password;
  const valid =
    currentPassword !== "" && passwordMet && confirmation === password;

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => {
            if (password !== "") setPasswordTouched(true);
          }}
        />
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          At least 6 characters.
          {/* Check and X share one fixed slot and trade opacity, so
              the state swap crossfades without nudging the text. */}
          <span className="relative flex size-3 shrink-0">
            <Check
              aria-hidden
              className={cn(
                "absolute inset-0 size-3 text-green-600 transition-opacity duration-300 dark:text-green-500",
                passwordMet ? "opacity-100" : "opacity-0",
              )}
              strokeWidth={2.5}
            />
            <X
              aria-hidden
              className={cn(
                "absolute inset-0 size-3 text-destructive transition-opacity duration-300",
                passwordUnmet ? "opacity-100" : "opacity-0",
              )}
              strokeWidth={2.5}
            />
          </span>
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
            onBlur={() => {
              if (confirmation !== "") setConfirmationTouched(true);
            }}
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
        <Button type="submit" disabled={pending || !valid}>
          {pending && <Spinner />}
          Change password
        </Button>
      </div>
    </form>
  );
}
