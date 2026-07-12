"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";

import {
  ArrowRight,
  Check,
  Link2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { setCity, startSync } from "../dashboard/actions";
import { AttentionDot } from "../dashboard/attention-dot";
import { type City } from "../dashboard/city-panel";
import { CitySearchBox, cityLabel } from "../dashboard/city-search-box";
import { type LastfmAccount } from "../dashboard/lastfm-panel";
import {
  CurrentStep,
  fetchStatus,
  POLL_INTERVAL_MS,
  StepList,
  type SyncStatus,
} from "../dashboard/sync-steps";
import { linkLastfmAccount } from "./actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type SetupStep = "city" | "lastfm" | "sync";
type StepState = "todo" | "active" | "done";

export function WelcomeFlow({
  initialLastfm,
  initialCity,
  initialSync,
}: {
  initialLastfm: LastfmAccount | null;
  initialCity: City | null;
  initialSync: SyncStatus | null;
}) {
  const [lastfm, setLastfm] = useState(initialLastfm);
  const [city, setCityState] = useState(initialCity);
  const [sync, setSync] = useState(initialSync);
  // A completed setup step reopened for correction; cleared on save.
  const [editing, setEditing] = useState<"city" | "lastfm" | null>(null);
  const [polling, setPolling] = useState(initialSync?.status === "running");
  // True from the end of a watched run until its step playback catches up,
  // so the finish doesn't cut the playback short (same as the sync card).
  const [settling, setSettling] = useState(false);
  const [runSeq, setRunSeq] = useState(0);
  const [starting, startTransition] = useTransition();
  const [pendingCity, setPendingCity] = useState<City | null>(null);
  const [, startCityTransition] = useTransition();

  const setupStep: SetupStep =
    city === null ? "city" : lastfm === null ? "lastfm" : "sync";
  const step = editing ?? setupStep;
  const outcome = sync?.status ?? "none";
  const syncActive = starting || polling || outcome === "running";

  // Deliberately not automatic: pressing the button is what teaches that
  // playlists come from a sync, the same one that then runs daily.
  function begin() {
    // Show the run as started right away; the first poll replaces this with
    // real state, and a failed start reverts to the button.
    setSettling(false);
    setRunSeq((seq) => seq + 1);
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
        toast.error(result.error);
        return;
      }
      setPolling(true);
    });
  }

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
        // Let the playback finish showing the remaining steps before the
        // final list takes over.
        setSettling(true);
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

  // Corrections are for the setup phase; once the first sync is under way
  // (or done), settings changes belong to the settings dialog.
  const canEdit = !syncActive && outcome !== "completed";

  const cityState: StepState =
    step === "city" ? "active" : city !== null ? "done" : "todo";
  const lastfmState: StepState =
    step === "lastfm" ? "active" : lastfm !== null ? "done" : "todo";
  // A live run (or its settle animation) always shows the playback; the
  // final list with the run's summaries takes over once it catches up.
  const showPlayback = syncActive || settling;
  const syncState: StepState =
    outcome === "completed" && !showPlayback
      ? "done"
      : step === "sync"
        ? "active"
        : "todo";

  return (
    <div className="space-y-6">
      <StepSection
        heading="Home City"
        state={cityState}
        description="A playlist is generated for concerts in your home city."
      >
        {cityState === "done" ? (
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 font-medium">{cityLabel(city!)}</p>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditing("city")}
                aria-label="Change home city"
                title="Change"
                className="text-muted-foreground"
              >
                <Pencil aria-hidden />
              </Button>
            )}
          </div>
        ) : pendingCity ? (
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 font-medium">{cityLabel(pendingCity)}</p>
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
              // mt-0.5 centers the icon on the input's height while staying
              // self-start, so it doesn't move when the search box's error
              // line appears below.
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
      </StepSection>
      <StepSection
        heading="Last.fm"
        state={lastfmState}
        description="Listening history is imported from your Last.fm account."
      >
        {lastfmState === "done" ? (
          <LinkedAccount
            account={lastfm!}
            onEdit={canEdit ? () => setEditing("lastfm") : undefined}
          />
        ) : (
          <LinkForm
            onLinked={(account) => {
              setLastfm(account);
              setEditing(null);
            }}
            onCancel={
              editing === "lastfm" ? () => setEditing(null) : undefined
            }
          />
        )}
      </StepSection>
      <StepSection
        heading="First Sync"
        state={syncState}
        description="Imports listening history, suggests artists, finds concerts and generates playlists."
      >
        {showPlayback ? (
          <div className="space-y-3">
            {/* The playback line reserves its two-line height so the card
                doesn't jump as steps come and go. */}
            <div className="flex min-h-9 items-center">
              <CurrentStep
                key={runSeq}
                steps={sync?.steps ?? []}
                finished={!polling && outcome !== "running"}
                onSettled={() => setSettling(false)}
              />
            </div>
            <p className="text-xs text-muted-foreground italic">
              The first sync can take a few minutes. It keeps running if you
              leave.
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
        ) : outcome === "completed" ? (
          <div className="animate-fade-in space-y-4">
            <StepList steps={sync?.steps ?? []} />
            <div className="animate-slide-in-up space-y-3">
              <p className="text-sm">All set. Playlists update daily.</p>
              <Button asChild size="sm">
                <Link href="/dashboard">
                  Go to dashboard
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        ) : outcome === "failed" ? (
          <div className="animate-fade-in space-y-4">
            <StepList steps={sync?.steps ?? []} />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={begin}>
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
          </div>
        ) : (
          <Button type="button" size="sm" onClick={begin}>
            Start first sync
          </Button>
        )}
      </StepSection>
    </div>
  );
}

// The settings dialog's section card, with the step's state on the title
// line: a pulsing attention dot marks the step to do now, a green check a
// completed one; steps not yet reached are dimmed, their content hidden
// until they activate.
function StepSection({
  heading,
  state,
  description,
  children,
}: {
  heading: string;
  state: StepState;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className={state === "todo" ? "text-muted-foreground" : undefined}>
            {heading}
          </h2>
          {state === "active" && <AttentionDot pulse />}
          {state === "done" && (
            <Check
              aria-hidden
              className="size-3.5 text-green-600 dark:text-green-500"
              strokeWidth={2.5}
            />
          )}
        </CardTitle>
        <CardDescription className="text-xs italic">
          {description}
        </CardDescription>
      </CardHeader>
      {state !== "todo" && (
        <CardContent className="animate-fade-in">{children}</CardContent>
      )}
    </Card>
  );
}

// The linked account, condensed from the settings Last.fm card: same
// avatar-and-details shape, with a single change control.
function LinkedAccount({
  account,
  onEdit,
}: {
  account: LastfmAccount;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-10">
        {account.avatar_url && <AvatarImage src={account.avatar_url} alt="" />}
        <AvatarFallback>
          {account.username.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{account.real_name ?? account.username}</p>
        <p className="truncate text-sm text-muted-foreground">
          {account.username}
        </p>
      </div>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          aria-label="Change Last.fm account"
          title="Change"
          className="text-muted-foreground"
        >
          <Pencil aria-hidden />
        </Button>
      )}
    </div>
  );
}

function LinkForm({
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
        <Button type="submit" size="sm" disabled={pending} className="shrink-0">
          {pending ? <Spinner /> : <Link2 aria-hidden />}
          Link account
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
