import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the welcome page's column: title, intro line, then one card per
// setup step. Held back briefly before fading in, like the dashboard's.
export default function Loading() {
  return (
    <main
      aria-busy
      className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center p-8"
    >
      <div className="animate-fade-in [animation-delay:500ms] [animation-fill-mode:backwards]">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="mt-2 h-3 w-80 max-w-full" />
        <div className="mt-6 space-y-6">
          {[0, 1, 2].map((index) => (
            <Card key={index}>
              <CardHeader className="gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-3/4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
