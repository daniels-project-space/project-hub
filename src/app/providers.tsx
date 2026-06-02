"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";
import { SettingsProvider } from "@/components/settings-provider";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
  );
  return (
    <ConvexProvider client={client}>
      <SettingsProvider>{children}</SettingsProvider>
    </ConvexProvider>
  );
}
