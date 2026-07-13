"use client";

import { useActionState, useState } from "react";
import { Check, Pencil } from "lucide-react";

import { changeEmail } from "./actions";
import type { ActionState } from "./actions";
import { AnimatedHeight } from "./animated-height";
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
      <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change email</DialogTitle>
        </DialogHeader>
        <AnimatedHeight>
          {sentTo !== null ? (
            <div className="grid gap-2 py-4 text-center">
              <p className="flex items-center justify-center gap-2 text-sm">
                <Check
                  aria-hidden
                  className="size-3.5 text-green-600 dark:text-green-500"
                  strokeWidth={2.5}
                />
                Emails sent
              </p>
              <p className="text-sm text-muted-foreground">
                Check the inboxes of {sentTo} and your current address. The
                change applies once both are confirmed.
              </p>
            </div>
          ) : (
            <form action={formAction} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="new-email">New email</Label>
                <div>
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
                  <Collapse
                    show={
                      emailTouched && email !== "" && !EMAIL_SHAPE.test(email)
                    }
                  >
                    <p className="pt-2 text-xs text-destructive">
                      Enter a valid email address.
                    </p>
                  </Collapse>
                </div>
              </div>
              <div className="grid">
                <Collapse show={state.error !== null}>
                  <p className="pb-3 text-sm text-destructive">{state.error}</p>
                </Collapse>
                <Button
                  type="submit"
                  disabled={pending || !EMAIL_SHAPE.test(email)}
                >
                  {pending && <Spinner />}
                  Send confirmation links
                </Button>
              </div>
            </form>
          )}
        </AnimatedHeight>
      </DialogContent>
    </Dialog>
  );
}
