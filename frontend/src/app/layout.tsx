import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { FaviconSync } from "./favicon-sync";
import { SoundwaveBackground } from "./soundwave-background";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Array (Fontshare) is self-hosted rather than loaded from next/font/google
// because it is not a Google font. It has no variable axis, so each weight is
// its own file; only the two the headings actually set are shipped.
const array = localFont({
  src: [
    { path: "./fonts/array-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/array-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
  // Array draws 12% shorter in the caps and 7% shorter in the x-height than
  // Geist at the same font-size, so a heading set in it reads a size small.
  // size-adjust scales the glyphs instead of the type scale, which keeps
  // text-2xl meaning text-2xl and lets every use inherit the correction.
  declarations: [{ prop: "size-adjust", value: "115%" }],
});

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
      className={cn(
        "h-full antialiased font-sans",
        geist.variable,
        array.variable,
      )}
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
