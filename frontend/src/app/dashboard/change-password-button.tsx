"use client";

import { useActionState, useState } from "react";
import { Check, Pencil } from "lucide-react";
import { toast } from "sonner";

import { changePassword } from "./actions";
import type { ActionState } from "./actions";
import { Collapse } from "../collapse";
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
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // Punish late, revalidate eagerly: the mismatch hint waits for the
  // confirm field's first blur, then tracks every edit until resolved.
  // An empty field shows nothing - it makes no mismatch claim yet.
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changePassword(prev, formData);
      // On success close the dialog and confirm with a toast.
      if (!result.error) {
        setOpen(false);
        toast.success("Password changed.");
      }
      return result;
    },
    { error: null },
  );

  const mismatch =
    confirmationTouched && confirmation !== "" && confirmation !== password;
  const valid =
    currentPassword !== "" && password.length >= 6 && confirmation === password;

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setCurrentPassword("");
      setPassword("");
      setConfirmation("");
      setConfirmationTouched(false);
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
              <p className="pb-3 text-sm text-destructive">{state.error}</p>
            </Collapse>
            <Button type="submit" disabled={pending || !valid}>
              {pending && <Spinner />}
              Change password
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
