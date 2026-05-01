"use client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
  );
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
