"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";

import { changeEmail } from "./actions";
import type { ActionState } from "./actions";
import { AnimatedHeight } from "./animated-height";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ChangeEmailButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  // Punish late, revalidate eagerly: the format hint waits for the field's
  // first blur, then tracks every edit until resolved.
  const [emailTouched, setEmailTouched] = useState(false);
  // The address the confirmation links went to; set on success, swaps the
  // form for the check-your-inboxes note.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const submitted = formData.get("email");
      const result = await changeEmail(prev, formData);
      if (!result.error && typeof submitted === "string") {
        setSentTo(submitted);
      }
      return result;
    },
    { error: null },
  );

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setEmail("");
      setEmailTouched(false);
      setSentTo(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Change email"
          title="Change email"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <AnimatedHeight>
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Change email</DialogTitle>
              <DialogDescription>
                Confirmation links are sent to both the current and the new
                address. The change applies once both are confirmed.
              </DialogDescription>
            </DialogHeader>
            {sentTo ? (
              <p className="text-sm text-muted-foreground">
                Check the inboxes of {sentTo} and your current address to
                confirm the change.
              </p>
            ) : (
              <form action={formAction} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="new-email">New email</Label>
                  <Input
                    id="new-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setEmailTouched(true)}
                  />
                  {emailTouched && email !== "" && !EMAIL_SHAPE.test(email) && (
                    <p className="text-xs text-destructive">
                      Enter a valid email address.
                    </p>
                  )}
                </div>
                {state.error && (
                  <p className="text-sm text-destructive">{state.error}</p>
                )}
                <Button
                  type="submit"
                  disabled={pending || !EMAIL_SHAPE.test(email)}
                >
                  {pending && <Spinner />}
                  Send confirmation links
                </Button>
              </form>
            )}
          </div>
        </AnimatedHeight>
      </DialogContent>
    </Dialog>
  );
}
