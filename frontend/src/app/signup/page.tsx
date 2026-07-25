import { AuthCard } from "@/components/auth-card";
import { Brand } from "@/components/brand";
import { InlineNav } from "@/components/inline-nav";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthCard
      title="Sign up"
      description={<>Create your <Brand /> account.</>}
      footer={
        <p className="text-sm text-muted-foreground">
          Already have an account? <InlineNav href="/login">Log in</InlineNav>
        </p>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
