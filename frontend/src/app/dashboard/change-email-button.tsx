"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";

import { changeEmail } from "./actions";
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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ChangeEmailButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  // Punish late, revalidate eagerly: the format hint waits for the field's
  // first blur, then tracks every edit until resolved.
  const [emailTouched, setEmailTouched] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const result = await changeEmail(prev, formData);
      // On success close the dialog; the change needs confirming from both
      // inboxes, so the toast spells that out.
      if (!result.error) {
        setOpen(false);
        toast.success("Confirmation links sent.", {
          description:
            "Confirm from both your current and new address to finish.",
        });
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
                show={emailTouched && email !== "" && !EMAIL_SHAPE.test(email)}
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
            <Button type="submit" disabled={pending || !EMAIL_SHAPE.test(email)}>
              {pending && <Spinner />}
              Send confirmation links
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
