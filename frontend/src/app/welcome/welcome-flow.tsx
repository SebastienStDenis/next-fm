"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { ArrowRight, Check, Pencil, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { setCity, startSync } from "../dashboard/actions";
import { type City } from "../dashboard/city-panel";
import { CitySearchBox, cityLabel } from "../dashboard/city-search-box";
import { type LastfmAccount } from "../dashboard/lastfm-panel";
import {
  fetchStatus,
  POLL_INTERVAL_MS,
  StepList,
  type SyncStatus,
} from "../dashboard/sync-steps";
import { linkLastfmAccount } from "./actions";
import { WELCOME_SKIPPED_COOKIE } from "./welcome-cookie";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type SetupStep = "lastfm" | "city" | "sync";

export function WelcomeFlow({
  initialLastfm,
  initialCity,
  initialSync,
}: {
  initialLastfm: LastfmAccount | null;
  initialCity: City | null;
  initialSync: SyncStatus | null;
}) {
  const router = useRouter();
  const [lastfm, setLastfm] = useState(initialLastfm);
  const [city, setCityState] = useState(initialCity);
  const [sync, setSync] = useState(initialSync);
  // A completed setup step reopened for correction; cleared on save.
  const [editing, setEditing] = useState<"lastfm" | "city" | null>(null);
  const [polling, setPolling] = useState(initialSync?.status === "running");
  const [startFailed, setStartFailed] = useState(false);
  const [starting, startTransition] = useTransition();
  const [pendingCity, setPendingCity] = useState<City | null>(null);
  const [, startCityTransition] = useTransition();
  // A run already on record (running, failed or completed) is never
  // restarted behind the user's back; only reaching the sync step with a
  // clean slate starts one.
  const autoStarted = useRef(
    initialSync !== null && initialSync.status !== "none",
  );

  const setupStep: SetupStep =
    lastfm === null ? "lastfm" : city === null ? "city" : "sync";
  const step = editing ?? setupStep;
  const outcome = sync?.status ?? "none";
  const syncActive = starting || polling || outcome === "running";

  const begin = useCallback(() => {
    setStartFailed(false);
    // Show the run as started right away; the first poll replaces this with
    // real state, and a failed start reverts it.
    setSync((prev) => ({
      status: "running",
      started_at: null,
      finished_at: null,
      steps: (prev?.steps ?? []).map((prevStep) => ({
        ...prevStep,
        status: "pending" as const,
        summary: null,
      })),
    }));
    startTransition(async () => {
      const result = await startSync();
      if (result.error) {
        setSync((prev) =>
          prev?.status === "running" ? { ...prev, status: "none" } : prev,
        );
        setStartFailed(true);
        toast.error(result.error);
        return;
      }
      setPolling(true);
    });
  }, []);

  // The last setup action flows straight into the first sync: reaching the
  // sync step with no run on record starts one.
  useEffect(() => {
    if (step === "sync" && outcome === "none" && !autoStarted.current) {
      autoStarted.current = true;
      begin();
    }
  }, [step, outcome, begin]);

  useEffect(() => {
    if (!polling) {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    async function tick() {
      // The status call can be slow under load; never let ticks stack up.
      if (inFlight) {
        return;
      }
      inFlight = true;
      const next = await fetchStatus();
      inFlight = false;
      if (cancelled || next === null) {
        return;
      }
      setSync(next);
      if (next.status !== "running") {
        setPolling(false);
      }
    }
    tick();
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [polling]);

  function pickCity(selected: City) {
    setPendingCity(selected);
    startCityTransition(async () => {
      const result = await setCity(selected.geonameid);
      setPendingCity(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setCityState(selected);
      setEditing(null);
    });
  }

  function skip() {
    document.cookie = `${WELCOME_SKIPPED_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    router.push("/dashboard");
  }

  // Corrections are for the setup phase; once the first sync is under way
  // (or done), settings changes belong to the settings dialog.
  const canEdit = !syncActive && outcome !== "completed";

  return (
    <div>
      <Card>
        <CardContent className="space-y-5">
          <SetupRow
            index={1}
            title="Last.fm"
            active={step === "lastfm"}
            done={lastfm !== null}
            summary={lastfm?.username}
            description="Listening history is imported from your Last.fm account."
            onEdit={
              lastfm !== null && step !== "lastfm" && canEdit
                ? () => setEditing("lastfm")
                : undefined
            }
          >
            <LastfmStep
              onLinked={(account) => {
                setLastfm(account);
                setEditing(null);
              }}
              onCancel={
                editing === "lastfm" ? () => setEditing(null) : undefined
              }
            />
          </SetupRow>
          <SetupRow
            index={2}
            title="Home City"
            active={step === "city"}
            done={city !== null}
            summary={city ? cityLabel(city) : undefined}
            description="A playlist is generated for concerts in your home city."
            onEdit={
              city !== null && step !== "city" && canEdit
                ? () => setEditing("city")
                : undefined
            }
          >
            {pendingCity ? (
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 text-sm font-medium">
                  {cityLabel(pendingCity)}
                </p>
                <span className="flex size-7 items-center justify-center text-muted-foreground">
                  <Spinner />
                </span>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <CitySearchBox
                    placeholder="Search for a city"
                    autoFocus
                    onSelect={pickCity}
                  />
                </div>
                {editing === "city" && (
                  // mt-0.5 centers the icon on the input's height while
                  // staying self-start, so it doesn't move when the search
                  // box's error line appears below.
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditing(null)}
                    aria-label="Cancel"
                    title="Cancel"
                    className="mt-0.5 self-start text-muted-foreground"
                  >
                    <X aria-hidden />
                  </Button>
                )}
              </div>
            )}
          </SetupRow>
          <SetupRow
            index={3}
            title="First Sync"
            active={step === "sync"}
            done={outcome === "completed"}
            description="Imports listening history, suggests artists, finds concerts and generates playlists."
          >
            <div className="space-y-4">
              <StepList steps={sync?.steps ?? []} />
              {outcome === "completed" ? (
                <div className="animate-slide-in-up space-y-3">
                  <p className="text-sm">All set. Playlists update daily.</p>
                  <Button asChild size="sm">
                    <Link href="/dashboard">
                      Go to dashboard
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              ) : (outcome === "failed" || startFailed) && !syncActive ? (
                <div className="flex flex-wrap items-center gap-2 animate-fade-in">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={begin}
                  >
                    <RefreshCw aria-hidden />
                    Try again
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  >
                    <Link href="/dashboard">
                      Go to dashboard
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground italic">
                    The first sync can take a few minutes. It keeps running if
                    you leave.
                  </p>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="-ml-2.5 text-muted-foreground"
                  >
                    <Link href="/dashboard">
                      Go to dashboard
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          </SetupRow>
        </CardContent>
      </Card>
      {setupStep !== "sync" && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={skip}
          className="mt-4 -ml-2.5 text-muted-foreground"
        >
          Skip for now
          <ArrowRight aria-hidden />
        </Button>
      )}
    </div>
  );
}

function SetupRow({
  index,
  title,
  active,
  done,
  summary,
  description,
  onEdit,
  children,
}: {
  index: number;
  title: string;
  active: boolean;
  done: boolean;
  summary?: string;
  description: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3">
      <span className="mt-0.5">
        <RowMark index={index} active={active} done={done} />
      </span>
      <div className="min-w-0">
        <h2
          className={cn(
            "text-sm font-medium",
            !active && !done && "text-muted-foreground",
          )}
        >
          {title}
        </h2>
        {!active && done && summary && (
          <p className="truncate text-xs text-muted-foreground">{summary}</p>
        )}
        {active && (
          <div className="mt-1 animate-fade-in space-y-3">
            <p className="text-xs text-muted-foreground italic">
              {description}
            </p>
            {children}
          </div>
        )}
      </div>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label={`Change ${title}`}
          title="Change"
          className="-my-1 text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      )}
    </div>
  );
}

function RowMark({
  index,
  active,
  done,
}: {
  index: number;
  active: boolean;
  done: boolean;
}) {
  if (done) {
    return (
      <span className="flex size-5 items-center justify-center text-green-600 dark:text-green-500">
        <Check aria-hidden className="size-3.5" strokeWidth={2.5} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 items-center justify-center rounded-full border text-xs tabular-nums",
        active ? "border-primary text-primary" : "text-muted-foreground",
      )}
    >
      {index}
    </span>
  );
}

function LastfmStep({
  onLinked,
  onCancel,
}: {
  onLinked: (account: LastfmAccount) => void;
  onCancel?: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error: string | null }, formData: FormData) => {
      const username = formData.get("username");
      if (typeof username !== "string" || username.trim() === "") {
        return { error: "Enter a Last.fm username." };
      }
      const result = await linkLastfmAccount(username.trim());
      if (result.error !== null) {
        return { error: result.error };
      }
      onLinked(result.account);
      return { error: null };
    },
    { error: null },
  );

  return (
    <form action={formAction} className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor="welcome-lastfm-username" className="sr-only">
          Last.fm username
        </Label>
        <Input
          id="welcome-lastfm-username"
          name="username"
          placeholder="Last.fm username"
          required
          disabled={pending}
          autoFocus
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Spinner />}
          Link
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onCancel}
            aria-label="Cancel"
            title="Cancel"
            className="text-muted-foreground"
          >
            <X aria-hidden />
          </Button>
        )}
      </div>
      {state.error && !pending && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
