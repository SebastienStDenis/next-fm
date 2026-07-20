import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { FaviconSync } from "./favicon-sync";
import { SoundwaveBackground } from "./soundwave-background";

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
      <body className="min-h-full">
        {/* min-w-80: below 320px the page scrolls horizontally instead of
            squeezing layouts past their breaking point. The floor lives on
            this wrapper, not on body: Floating UI reads a body wider than
            the window as a scrollbar gutter (when within ~25px) and shrinks
            popover collision bounds by the difference. */}
        <div
          data-soundwave-background
          className="flex min-h-dvh min-w-80 flex-col"
        >
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <FaviconSync />
            <SoundwaveBackground />
            {children}
            <Toaster />
          </ThemeProvider>
          <Analytics />
        </div>
      </body>
    </html>
  );
}
