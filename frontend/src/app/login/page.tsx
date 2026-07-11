import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HomeLink } from "../home-link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Log in</h1>
          </CardTitle>
          <CardDescription>Welcome back to Next.fm.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            No account?{" "}
            <Link
              href="/signup"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Sign up
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
