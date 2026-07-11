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
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Sign up</h1>
          </CardTitle>
          <CardDescription>Create your Next.fm account.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Log in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
