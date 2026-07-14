import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "NextFM",
  description: "Live-music discovery through listening",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased font-sans", geist.variable)}
      suppressHydrationWarning
    >
      {/* min-w-80: below 320px the page scrolls horizontally instead of
          squeezing layouts past their breaking point. */}
      <body className="min-h-full min-w-80 flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
