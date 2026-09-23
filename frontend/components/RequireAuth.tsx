"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authed) router.replace("/login");
  }, [ready, authed, router]);

  if (!ready) return <p className="muted">Зареждане…</p>;
  if (!authed) return null;
  return <>{children}</>;
}
