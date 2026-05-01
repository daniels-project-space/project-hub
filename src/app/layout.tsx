import type { Metadata } from "next";
import { Fraunces, Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const display = Fraunces({
  subsets: ["latin"],
  // variable font: omit weight
  style: ["normal", "italic"],
  axes: ["SOFT", "opsz"],
  variable: "--font-display",
  display: "swap",
});
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project Hub",
  description: "Daniel's umbrella dashboard for all apps",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body className="min-h-dvh bg-ink text-paper antialiased">
        <div
          aria-hidden
          className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
        >
          <div
            className="absolute -top-[35vh] left-1/2 -translate-x-1/2 w-[120vw] h-[80vw] rounded-full opacity-100"
            style={{
              background:
                "radial-gradient(ellipse 60% 60% at 50% 50%, oklch(0.78 0.08 65 / 0.10), transparent 70%)",
            }}
          />
          <div
            className="absolute -bottom-[40vh] -right-[20vw] w-[80vw] h-[80vw] rounded-full opacity-100"
            style={{
              background:
                "radial-gradient(closest-side, oklch(0.78 0.08 175 / 0.06), transparent 70%)",
            }}
          />
          <div className="absolute inset-0 bg-grain opacity-[0.06] mix-blend-overlay" />
        </div>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
