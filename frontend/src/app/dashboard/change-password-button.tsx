"use client";

import { useActionState, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { toast } from "sonner";

import { changePassword } from "./actions";
import type { ActionState } from "./actions";
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

export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Punish late: the mismatch hint never judges the confirmation while
  // it's being edited, only once the user leaves the field. The submit
  // button enabling still gives live match feedback.
  const [confirmationFocused, setConfirmationFocused] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changePassword(prev, formData);
      if (!result.error) {
        setOpen(false);
        toast.success("Password changed.");
      }
      return result;
    },
    { error: null },
  );

  const mismatch =
    !confirmationFocused && confirmation !== "" && confirmation !== password;
  const valid =
    currentPassword !== "" && password.length >= 6 && confirmation === password;

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            />
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {password.length >= 6 && (
                <Check
                  aria-hidden
                  className="size-3 animate-fade-in text-green-600 dark:text-green-500"
                  strokeWidth={2.5}
                />
              )}
              At least 6 characters.
            </p>
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
              <p className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
          {state.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={pending || !valid}>
            {pending && <Spinner />}
            Change password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
