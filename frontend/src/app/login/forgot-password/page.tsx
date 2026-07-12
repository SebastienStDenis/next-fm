import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HomeLink } from "../../home-link";
import { InlineNav } from "../../inline-nav";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Reset your password</h1>
          </CardTitle>
          <CardDescription>
            A reset link will be sent to your email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            Remembered it? <InlineNav href="/login">Log in</InlineNav>
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
