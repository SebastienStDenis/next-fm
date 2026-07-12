"use client";

import { Check, Circle, X } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

export type SyncStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  summary: string | null;
};

export type SyncStatus = {
  status: "none" | "running" | "completed" | "failed";
  started_at: string | null;
  finished_at: string | null;
  steps: SyncStep[];
};

export const POLL_INTERVAL_MS = 1500;

export const stepMarkClasses: Record<SyncStep["status"], string> = {
  pending: "text-muted-foreground",
  running: "",
  completed: "text-green-600 dark:text-green-500",
  failed: "text-destructive",
};

export async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const res = await fetch(`/api/me/sync`);
    if (!res.ok) {
      return null;
    }
    return res.json();
  } catch {
    return null;
  }
}

export function StepList({ steps }: { steps: SyncStep[] }) {
  return (
    <ul className="space-y-1.5">
      {steps.map((step) => (
        <li
          key={step.key}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-sm"
        >
          <span className={stepMarkClasses[step.status]}>
            <StepMark status={step.status} />
          </span>
          <div className="min-w-0">
            <span
              className={
                step.status === "pending" ? "text-muted-foreground" : undefined
              }
            >
              {step.label}
            </span>
            {step.status === "failed" && (
              <span className="ml-2 text-xs text-destructive">failed</span>
            )}
          </div>
          {step.summary && (
            <p className="col-start-2 text-xs text-muted-foreground">
              {step.summary}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function StepMark({ status }: { status: SyncStep["status"] }) {
  if (status === "completed") {
    return <Check aria-hidden className="size-3.5" strokeWidth={2.5} />;
  }
  if (status === "failed") {
    return <X aria-hidden className="size-3.5" strokeWidth={2.5} />;
  }
  if (status === "running") {
    return <Spinner className="size-3.5" />;
  }
  return <Circle aria-hidden className="size-3.5" />;
}
