"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useI18n } from "./I18nProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { authed, ready } = useAuth();
  const { t } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authed) router.replace("/login");
  }, [ready, authed, router]);

  if (!ready) return <p className="muted">{t("common.loading")}</p>;
  if (!authed) return null;
  return <>{children}</>;
}
