import { type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Haze } from "./haze";
import { HomeLink } from "./home-link";

export function AuthCard({
  title,
  description,
  before,
  contentClassName,
  footer,
  children,
}: {
  title: string;
  description?: ReactNode;
  before?: ReactNode;
  contentClassName?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center p-8">
      {before}
      {/* The auth pages render the soundwave field, so the link needs a scrim
          to keep the dots from showing through the ghost button. */}
      <Haze className="w-fit">
        <HomeLink href="/" />
      </Haze>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1>{title}</h1>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent className={contentClassName}>{children}</CardContent>
        {footer && <CardFooter>{footer}</CardFooter>}
      </Card>
    </main>
  );
}
