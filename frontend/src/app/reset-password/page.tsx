import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { HomeLink } from "../home-link";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      <HomeLink href="/" />
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>Choose a new password</h1>
          </CardTitle>
          <CardDescription>
            It replaces your old password right away.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
