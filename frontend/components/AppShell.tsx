"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { api, FsUsage } from "../lib/api";
import { IconFolder, IconLogout, IconUsers } from "./icons";

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
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [usage, setUsage] = useState<FsUsage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
  }, []);

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
        <div className="menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="avatar"
            aria-label="Профил"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {initialsOf(email)}
          </button>
          {menuOpen ? (
            <div className="menu">
              <div className="menu-head">{email}</div>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
              >
                <IconLogout /> Изход
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="sidebar">
        <Link href="/" className={`nav-item${pathname === "/" ? " active" : ""}`}>
          <IconFolder /> Файлове
        </Link>
        {me?.is_admin === 1 ? (
          <Link href="/users" className={`nav-item${pathname === "/users" ? " active" : ""}`}>
            <IconUsers /> Потребители
          </Link>
        ) : null}
        <div className="quota">
          <div className="bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          {formatBytes(used)} от {formatBytes(quota)}
        </div>
      </nav>

      <div className="content">{children}</div>
    </div>
  );
}
