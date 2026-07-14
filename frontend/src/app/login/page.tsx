import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HomeLink } from "../home-link";
import { InlineNav } from "../inline-nav";
import { LoginForm } from "./login-form";
import { LoginNotice } from "./login-notice";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <Suspense>
        <LoginNotice />
      </Suspense>
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Log in</h1>
          </CardTitle>
          <CardDescription>Welcome back to NextFM.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <LoginForm />
        </CardContent>
        <CardFooter>
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">
              No account? <InlineNav href="/signup">Sign up</InlineNav>
            </p>
            <p className="text-sm text-muted-foreground">
              Forgot your password?{" "}
              <InlineNav href="/login/forgot-password">Reset it</InlineNav>
            </p>
          </div>
        </CardFooter>
      </Card>
    </main>
  );
}
