"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RequireAuth } from "../../components/RequireAuth";
import { useAuth } from "../../components/AuthProvider";
import { ApiError, api } from "../../lib/api";

type Me = { sub?: string; is_admin?: number; name?: string };
type UserRow = { id: number; email: string; name: string; is_admin: number };
type UserList = { items: UserRow[]; count: number };

function messageOf(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "грешка";
}

function UsersScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setBusy(true);
      setError("");
      try {
        const who = await api.get<Me>("/v1/me");
        if (cancel) return;
        setMe(who);
        if (who.is_admin !== 1) {
          setBusy(false);
          return;
        }
        const list = await api.get<UserList>("/v1/users");
        if (cancel) return;
        setRows(list.items ?? []);
      } catch (err) {
        if (!cancel) setError(messageOf(err));
      } finally {
        if (!cancel) setBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [reload]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/v1/users", {
        email,
        name,
        password,
        is_admin: admin,
      });
      setEmail("");
      setName("");
      setPassword("");
      setAdmin(false);
      setReload((n) => n + 1);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="top">
        <b>7x7office · secp</b>
        <Link href="/">Файлове</Link>
        <span className="grow" />
        <span className="who">{me?.sub}</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            logout();
            router.replace("/login");
          }}
        >
          Изход
        </button>
      </header>
      <main className="wrap">
        <h1>Потребители</h1>
        {me && me.is_admin !== 1 ? <p className="err">Само администратор вижда тази страница.</p> : null}
        {error ? <p className="err">{error}</p> : null}
        {me?.is_admin === 1 ? (
          <>
            <form className="toolbar" onSubmit={onCreate}>
              <input
                type="email"
                required
                placeholder="Имейл"
                aria-label="Имейл"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                placeholder="Име"
                aria-label="Име"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Парола"
                aria-label="Парола"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <label className="check">
                <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
                админ
              </label>
              <button type="submit" disabled={busy}>
                Създай
              </button>
            </form>
            {busy ? <p className="muted">Зареждане…</p> : null}
            <ul className="files">
              {rows.map((row) => (
                <li key={row.id}>
                  <span className="ph">{row.is_admin === 1 ? "A" : "·"}</span>
                  <span className="name static">{row.email}</span>
                  <span className="meta">{row.name || "—"}</span>
                  <span className="meta">{row.is_admin === 1 ? "админ" : "потребител"}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </>
  );
}

export default function UsersPage() {
  return (
    <RequireAuth>
      <UsersScreen />
    </RequireAuth>
  );
}
