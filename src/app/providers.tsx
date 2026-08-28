"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";
import { SettingsProvider } from "@/components/settings-provider";
import { TodosProvider } from "@/lib/todos-client";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
  );
  return (
    <ConvexProvider client={client}>
      <TodosProvider>
        <SettingsProvider>{children}</SettingsProvider>
      </TodosProvider>
    </ConvexProvider>
  );
}
