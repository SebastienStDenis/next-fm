import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { HomeLink } from "../../home-link";

export default function EmailChangePendingPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Almost there</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The email change needs confirming from both addresses. Open the link
            sent to your other inbox to finish.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
