import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
import { Analytics } from "@vercel/analytics/next";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { FaviconSync } from "./favicon-sync";
import { SoundwaveBackground } from "./soundwave-background";

// Both faces are Fontshare, so both are self-hosted. Satoshi carries a real
// italic, which the asides and `q` in globals.css lean on; without it the
// browser would slant the upright instead.
const satoshi = localFont({
  src: [
    {
      path: "./fonts/satoshi-variable.woff2",
      weight: "300 900",
      style: "normal",
    },
    {
      path: "./fonts/satoshi-variable-italic.woff2",
      weight: "300 900",
      style: "italic",
    },
  ],
  variable: "--font-sans",
  display: "swap",
});

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
  // Array draws its caps 14% shorter than Satoshi at the same font-size, so an
  // unadjusted heading reads a size small. size-adjust scales the glyphs
  // instead of the type scale, which keeps text-2xl meaning text-2xl and lets
  // every use inherit the correction. The two faces disagree about the
  // x-height-to-cap ratio and no single number satisfies both; caps win,
  // because that is what carries a heading.
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
        satoshi.variable,
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
