import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormError } from "../form-error";
import { HomeLink } from "../home-link";
import { InlineNav } from "../inline-nav";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // /auth/confirm redirects here when an emailed link's token is invalid
  // or expired.
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Log in</h1>
          </CardTitle>
          <CardDescription>Welcome back to NextFM.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error === "confirm" && (
            <FormError>That email link is invalid or has expired.</FormError>
          )}
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
