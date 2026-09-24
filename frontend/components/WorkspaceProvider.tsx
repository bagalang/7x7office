"use client";

// WorkspaceProvider — кой workspace е активен в момента (Фаза 2).
//
// Държи се като I18nProvider: стойността е в localStorage, четенето минава
// през useSyncExternalStore, за да е хидрaтационно-безопасно. При смяна на
// workspace всички файлови изгледи се презареждат (key-ът им е id-то).
//
// Защо е контекст, а не локален state в AppShell: файловият браузър и
// търсенето са отделни компоненти и трябва да знаят кога да се презаредят.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  ReactNode,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Workspace,
  getActiveWorkspace,
  listWorkspaces,
  setActiveWorkspace,
} from "../lib/api";
import { subscribeStorage } from "../lib/storage";

interface WorkspaceContextValue {
  wsId: number;
  workspaces: Workspace[];
  active: Workspace | null;
  reload: () => void;
  select: (id: number) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue>({
  wsId: 0,
  workspaces: [],
  active: null,
  reload: () => {},
  select: () => {},
});

function storedWs(): number {
  return getActiveWorkspace();
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const wsId = useSyncExternalStore(subscribeStorage, storedWs, () => 0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let dead = false;
    listWorkspaces()
      .then((list) => {
        if (dead) return;
        const items = list.items ?? [];
        setWorkspaces(items);
        // Ако избраният вече не съществува (махнат от друг член, изтрит),
        // връщаме се на личния, за да не остане клиентът с 404-та.
        const cur = getActiveWorkspace();
        if (cur > 0 && !items.some((w) => w.id === cur)) {
          setActiveWorkspace(0);
        }
      })
      .catch(() => {
        if (!dead) setWorkspaces([]);
      });
    return () => {
      dead = true;
    };
  }, [tick]);

  const active = workspaces.find((w) => w.id === wsId) ?? null;

  const value = useMemo<WorkspaceContextValue>(
    () => ({ wsId, workspaces, active, reload, select: setActiveWorkspace }),
    [wsId, workspaces, active, reload],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}

// Може ли активният workspace да се пише (editor/owner/admin)?
// Използва се, за да не показва UI-ът бутони, които сървърът ще върне 403.
export function canWrite(ws: Workspace | null): boolean {
  if (!ws) return true; // личният — винаги може
  return ws.role === "owner" || ws.role === "editor" || ws.role === "admin";
}
