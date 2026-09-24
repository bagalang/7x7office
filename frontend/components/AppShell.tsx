"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useI18n } from "./I18nProvider";
import { PreferencesButton } from "./PreferencesButton";
import { useWorkspace } from "./WorkspaceProvider";
import { api, FsUsage } from "../lib/api";
import { IconActivity, IconClose, IconFolder, IconLogout, IconSearch, IconUsers, IconWorkspaces } from "./icons";
import { ActivityFeed } from "./ActivityFeed";

export type Me = { sub?: string; name?: string; is_admin?: number };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

function initialsOf(email: string): string {
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function AppShell({ search, children }: { search?: ReactNode; children: ReactNode }) {
  const { logout } = useAuth();
  const { t } = useI18n();
  const { wsId, workspaces, select } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Квотата е на потребител, не на workspace, но се преизчислява при смяна на
  // workspace, за да не остане стар надпис, докато файловете вече са други.
  useEffect(() => {
    let cancel = false;
    Promise.all([api.get<Me>("/v1/me"), api.get<FsUsage>("/v1/fs/usage")])
      .then(([who, use]) => {
        if (cancel) return;
        setMe(who);
        setUsage(use);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [wsId]);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const used = usage?.used_bytes ?? 0;
  const quota = usage?.quota_bytes ?? 0;
  const pct = quota > 0 ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  const email = me?.sub ?? "";

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="logo">
          <span className="logo-mark">7×7</span>
          7x7office
        </Link>
        {search}
        <span className="grow" />
        {workspaces.length > 0 ? (
          <label className="ws-switch">
            <IconWorkspaces width={16} height={16} />
            <select
              className="select"
              aria-label={t("ws.switch_aria")}
              value={wsId}
              onChange={(e) => {
                select(Number(e.target.value));
                // Смяната на пространството сменя файловете — връщаме се в
                // корена, за да не сочи пътят към папка, която там я няма.
                if (pathname === "/") router.replace("/");
                else router.push("/");
              }}
            >
              {/* 0 = личният workspace; сървърът го намира сам, без id. */}
              <option value={0}>{t("ws.personal_files")}</option>
              {workspaces
                .filter((w) => w.is_personal === 0)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <PreferencesButton />
        <button
          type="button"
          className={`icon-btn${activityOpen ? " active" : ""}`}
          title={t("activity.title")}
          aria-label={t("activity.title")}
          aria-pressed={activityOpen}
          onClick={() => setActivityOpen((v) => !v)}
        >
          <IconActivity />
        </button>
        <div className="menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="avatar"
            aria-label={t("nav.profile")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {initialsOf(email)}
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <div className="menu-head">{email}</div>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
              >
                <IconLogout /> {t("nav.logout")}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="sidebar">
        <Link href="/" className={`nav-item${pathname === "/" ? " active" : ""}`}>
          <IconFolder /> {t("nav.files")}
        </Link>
        <Link href="/search" className={`nav-item${pathname === "/search" ? " active" : ""}`}>
          <IconSearch width={17} height={17} /> {t("nav.search")}
        </Link>
        <Link href="/workspaces" className={`nav-item${pathname === "/workspaces" ? " active" : ""}`}>
          <IconWorkspaces /> {t("nav.workspaces")}
        </Link>
        {me?.is_admin === 1 ? (
          <Link href="/users" className={`nav-item${pathname === "/users" ? " active" : ""}`}>
            <IconUsers /> {t("nav.users")}
          </Link>
        ) : null}
        <div className="quota">
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          {t("quota.used_of", { used: formatBytes(used), quota: formatBytes(quota) })}
        </div>
      </nav>

      <div className="content">
        {children}
        {activityOpen ? (
          <aside className="activity-pane" aria-label={t("activity.title")}>
            <div className="activity-bar">
              <span className="label">{t("activity.title")}</span>
              <span className="grow" />
              <button
                type="button"
                className="icon-btn"
                title={t("common.close")}
                aria-label={t("common.close")}
                onClick={() => setActivityOpen(false)}
              >
                <IconClose />
              </button>
            </div>
            <p className="muted small">{t("activity.hint")}</p>
            {/* key={wsId}: смяната на пространството трябва да презареди лентата,
                а не да остави действията на предишното. */}
            <ActivityFeed key={wsId} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
