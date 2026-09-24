import { readStorage, writeStorage } from "./storage";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
export const TOKEN_KEY = "secp.token";
const WS_KEY = "secp.ws";

export function getToken(): string | null {
  return readStorage(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  writeStorage(TOKEN_KEY, token);
}

// --- активен workspace (фаза 2) ---
// Файловете живеят в workspace, не в потребител. Клиентът пази кой е
// избраният и всички файлови заявки минават през него. `0` = не е избран →
// сървърът ползва личния workspace, т.е. поведението отпреди фаза 2.
export function getActiveWorkspace(): number {
  const raw = readStorage(WS_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function setActiveWorkspace(id: number): void {
  writeStorage(WS_KEY, id > 0 ? String(id) : null);
}

// Добавя workspace_id към заявка, ако има избран workspace. Едно място за
// цялото приложение — иначе всеки извикващ трябва да помни да го сложи.
// Идемпотентно: ако вече има workspace_id (напр. `/v1/workspaces?workspace_id=`)
// не слага втори — иначе заявката носи `workspace_id=1&workspace_id=1`.
function withWs(path: string): string {
  const id = getActiveWorkspace();
  if (!id) return path;
  if (path.includes("workspace_id=")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}workspace_id=${id}`;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailOf(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.length > 0) return data;
  if (!data || typeof data !== "object") return fallback;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string" && detail.length > 0) return detail;
  return fallback;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Файловите пътища носят workspace-а (Фаза 2). Правим го в едно място, а не
// във всеки извикващ: иначе рано или късно някой `api.get("/v1/fs/...")`
// остава без скоуп и чете личния workspace, докато UI-ът показва екипен.
function scoped(path: string): string {
  if (
    path.startsWith("/v1/fs/") ||
    path.startsWith("/v1/doc/") ||
    path.startsWith("/v1/search") ||
    path.startsWith("/v1/activity") ||
    path.startsWith("/v1/chat")
  ) {
    return withWs(path);
  }
  return path;
}

export async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${scoped(path)}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, "GET"),
  post: <T>(path: string, body?: unknown) => request<T>(path, "POST", body),
  del: <T>(path: string) => request<T>(path, "DELETE"),
  // Preview връща типизиран `kind`; текстовото съдържание (ако има) е в `text`.
  preview: (path: string) =>
    request<{ kind: string; text: string }>(withWs(`/v1/fs/preview?path=${qpath(path)}`), "GET"),
};

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
}

// Същото, но със активния workspace — за файловите заявки, които носят
// двоично съдържание (качване/сваляне/преглед на картинки).
export async function authedFetchWs(path: string, init: RequestInit = {}): Promise<Response> {
  return authedFetch(withWs(path), init);
}

export type TokenResponse = {
  access_token?: string;
  sub?: string;
};

export async function login(email: string, password: string): Promise<TokenResponse> {
  const data = await request<TokenResponse>("/v1/auth/login", "POST", { email, password });
  if (!data.access_token) throw new ApiError(401, "няма токен");
  setToken(data.access_token);
  return data;
}

// Заявка за смяна на забравена парола. Сървърът винаги отговаря 200
// (без да издава дали имейлът съществува), затова няма клон за „няма
// такъв потребител".
export async function requestPasswordReset(email: string): Promise<string> {
  const data = await request<{ message?: string }>("/v1/auth/forgot", "POST", { email });
  return data.message ?? "";
}

// Смяна на паролата с токен от писмото.
export async function resetPassword(token: string, password: string): Promise<string> {
  const data = await request<{ message?: string }>("/v1/auth/reset", "POST", { token, password });
  return data.message ?? "";
}

export function logout(): void {
  const token = getToken();
  setToken(null);
  if (!token) return;
  void fetch(`${API_BASE}/v1/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

export type FsNode = {
  id: number;
  name: string;
  path: string;
  is_dir: number;
  size: number;
  has_thumb: number;
  etag?: string;
  updated_at?: string;
};

export type FsList = { path: string; items: FsNode[]; count: number };
export type FsUsage = { used_bytes: number; quota_bytes: number };

export function qpath(path: string): string {
  return encodeURIComponent(path);
}

export async function putFile(path: string, body: Blob): Promise<FsNode> {
  const res = await authedFetchWs(`/v1/fs/file?path=${qpath(path)}`, { method: "PUT", body });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as FsNode;
}

export async function downloadFile(node: FsNode): Promise<void> {
  const res = await authedFetchWs(`/v1/fs/file?path=${qpath(node.path)}`);
  if (!res.ok) {
    const data = await readBody(res);
    throw new ApiError(res.status, detailOf(data, res.statusText));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = node.name;
  a.click();
  URL.revokeObjectURL(url);
}

export type DocContent = {
  name: string;
  path: string;
  kind: string;
  format: string;
  text: string;
  etag?: string;
};

export async function loadDoc(path: string): Promise<DocContent> {
  return request<DocContent>(withWs(`/v1/doc/load?path=${qpath(path)}`), "GET");
}

// The editor sends the etag it loaded; on a mismatch the backend stores the
// new content as a `.conflict-*` copy and answers 409 instead of overwriting.
export async function saveDoc(path: string, text: string, etag?: string): Promise<FsNode> {
  const q = etag ? `&etag=${encodeURIComponent(etag)}` : "";
  const res = await authedFetchWs(`/v1/doc/save?path=${qpath(path)}${q}`, {
    method: "PUT",
    body: text,
  });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as FsNode;
}

export type ZipEntry = { name: string; size: number; is_dir: number };
export type ZipList = { path: string; items: ZipEntry[]; count: number };

export async function listZip(path: string): Promise<ZipList> {
  return request<ZipList>(withWs(`/v1/fs/zip/list?path=${qpath(path)}`), "GET");
}

export async function downloadZipEntry(node: FsNode, entry: string): Promise<void> {
  const res = await authedFetchWs(`/v1/fs/zip/get?path=${qpath(node.path)}&entry=${encodeURIComponent(entry)}`);
  if (!res.ok) {
    const data = await readBody(res);
    throw new ApiError(res.status, detailOf(data, res.statusText));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = entry.split("/").filter(Boolean).pop() ?? "file";
  a.click();
  URL.revokeObjectURL(url);
}

export type FsVersion = {
  id: number;
  size: number;
  etag: string;
  created_at?: string;
};

export type FsVersionList = { path: string; items: FsVersion[]; count: number };

export async function listVersions(path: string): Promise<FsVersionList> {
  return request<FsVersionList>(withWs(`/v1/fs/versions?path=${qpath(path)}`), "GET");
}

export async function restoreVersion(path: string, version: number): Promise<FsNode> {
  return request<FsNode>(withWs(`/v1/fs/version/restore?path=${qpath(path)}&version=${version}`), "POST");
}

export async function downloadVersion(node: FsNode, version: number): Promise<void> {
  const res = await authedFetchWs(`/v1/fs/version/get?path=${qpath(node.path)}&version=${version}`);
  if (!res.ok) {
    const data = await readBody(res);
    throw new ApiError(res.status, detailOf(data, res.statusText));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = node.name;
  a.click();
  URL.revokeObjectURL(url);
}

// --- търсене (фаза 6) ---

export type SearchHit = {
  id: number;
  name: string;
  path: string;
  is_dir: number;
  size: number;
  in_text: number;
  updated_at?: string;
};

export type SearchResult = {
  query: string;
  limit: number;
  items: SearchHit[];
  count: number;
};

export async function searchFiles(query: string, limit = 25): Promise<SearchResult> {
  return request<SearchResult>(withWs(`/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`), "GET");
}

// --- workspaces + членство (фаза 2) ---

export type Workspace = {
  id: number;
  slug: string;
  label: string;
  description: string;
  is_personal: number;
  owner_id: number;
  role: string;
  created_at?: string;
};

export type WorkspaceList = { items: Workspace[]; count: number };
export type Member = {
  member_id: number;
  user_id: number;
  role: string;
  email: string;
  name: string;
};
export type MemberList = { items: Member[]; count: number };

// Ролите са фиксирана тройка (вж. idm/ws_roles.baga). Показваме нивата, за
// да не дава UI-ът повече, отколкото сървърът приема.
export const WS_ROLES = ["owner", "editor", "viewer"] as const;

export async function listWorkspaces(): Promise<WorkspaceList> {
  return request<WorkspaceList>("/v1/workspaces", "GET");
}

export async function createWorkspace(label: string, description: string): Promise<Workspace> {
  return request<Workspace>("/v1/workspaces", "POST", { label, description });
}

export async function updateWorkspace(id: number, label: string, description: string): Promise<Workspace> {
  return request<Workspace>(`/v1/workspaces?workspace_id=${id}`, "PATCH", { label, description });
}

export async function deleteWorkspace(id: number): Promise<void> {
  return request<void>(`/v1/workspaces?workspace_id=${id}`, "DELETE");
}

export async function listMembers(workspaceId: number): Promise<MemberList> {
  return request<MemberList>(`/v1/workspaces/members?workspace_id=${workspaceId}`, "GET");
}

export async function addMember(workspaceId: number, email: string, role: string): Promise<Member> {
  return request<Member>(`/v1/workspaces/members?workspace_id=${workspaceId}`, "POST", { email, role });
}

export async function updateMember(workspaceId: number, memberId: number, role: string): Promise<Member> {
  return request<Member>(`/v1/workspaces/members?workspace_id=${workspaceId}&member_id=${memberId}`, "PATCH", { role });
}

export async function removeMember(workspaceId: number, memberId: number): Promise<void> {
  return request<void>(`/v1/workspaces/members?workspace_id=${workspaceId}&member_id=${memberId}`, "DELETE");
}

// --- изрични права по възел / ACL (фаза 2) ---
// Само owner/admin на пространството. `level`: 0=нищо, 1=четене, 2=запис,
// 3=споделяне. `inherit`: 1=важи и за всичко под пътя, 0=само точния път.
export const ACL_LEVELS = [0, 1, 2, 3] as const;

export type AclRow = {
  id: number;
  path: string;
  kind: "user" | "role";
  subject_user_id: number;
  subject_role: string;
  subject_email?: string;
  subject_name?: string;
  level: number;
  inherit: number;
};

export type AclList = { path: string; workspace_id: number; items: AclRow[]; count: number };

export async function listAcl(workspaceId: number, path: string): Promise<AclList> {
  return request<AclList>(
    `/v1/fs/acl?workspace_id=${workspaceId}&path=${qpath(path)}`,
    "GET",
  );
}

export async function setAcl(
  workspaceId: number,
  input:
    | { path: string; kind: "user"; email: string; level: number; inherit: number }
    | { path: string; kind: "role"; role: string; level: number; inherit: number },
): Promise<AclRow> {
  return request<AclRow>(`/v1/fs/acl?workspace_id=${workspaceId}`, "POST", input);
}

export async function deleteAcl(workspaceId: number, aclId: number): Promise<void> {
  return request<void>(`/v1/fs/acl?workspace_id=${workspaceId}&acl_id=${aclId}`, "DELETE");
}

// --- публични линкове (фаза 3) ---
// Линкът дава достъп БЕЗ вход. `level` 1=четене, 2=качване (само папка).
// `expires_h` е в часове (0 = без срок); `max_downloads` 0 = без таван.
export type ShareLink = {
  id: number;
  workspace_id: number;
  path: string;
  level: number;
  expires_at: number;
  downloads: number;
  max_downloads: number;
  created_at: number;
  revoked_at: number;
  has_password: number;
  // само при създаване: суровият токен и готовият URL (после не се виждат)
  token?: string;
  url?: string;
};

export type ShareList = { path: string; workspace_id: number; items: ShareLink[]; count: number };

export type ShareCreateInput = {
  path: string;
  level?: number;
  expires_h?: number;
  max_downloads?: number;
  password?: string;
};

export async function listShares(workspaceId: number, path: string): Promise<ShareList> {
  return request<ShareList>(`/v1/fs/share?workspace_id=${workspaceId}&path=${qpath(path)}`, "GET");
}

export async function createShare(workspaceId: number, input: ShareCreateInput): Promise<ShareLink> {
  return request<ShareLink>(`/v1/fs/share?workspace_id=${workspaceId}`, "POST", input);
}

export async function revokeShare(workspaceId: number, shareId: number): Promise<void> {
  return request<void>(`/v1/fs/share?workspace_id=${workspaceId}&share_id=${shareId}`, "DELETE");
}

// --- публичната страна на линка (без Bearer) ---
export type ShareMeta = {
  path: string;
  name: string;
  is_dir: number;
  size: number;
  needs_password: number;
  unlocked: number;
  level: number;
  downloads: number;
  max_downloads: number;
  expires_at: number;
};

export type ShareView = {
  path: string;
  is_dir: number;
  level: number;
  items?: FsNode[];
  count?: number;
  name?: string;
  size?: number;
  mime?: string;
  content?: string;
};

// Публичните заявки НЕ минават през `request` (той слага Bearer и workspace),
// а директно към API_BASE — иначе линкът „вътрешно" изисква вход.
export async function shareMeta(token: string): Promise<ShareMeta> {
  const res = await fetch(`${API_BASE}/s/${token}`, { cache: "no-store" });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as ShareMeta;
}

export async function shareUnlock(token: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/s/${token}/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    cache: "no-store",
  });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return (data as { pass_token?: string }).pass_token ?? "";
}

export async function shareView(token: string, path: string, pass: string): Promise<ShareView> {
  const q = pass ? `&pass=${encodeURIComponent(pass)}` : "";
  const res = await fetch(`${API_BASE}/s/${token}/view?path=${qpath(path)}${q}`, { cache: "no-store" });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as ShareView;
}

// Сваляне през линка: връща blob URL, за да не минава през Bearer.
export async function shareDownload(token: string, path: string, pass: string, name: string): Promise<void> {
  const q = pass ? `&pass=${encodeURIComponent(pass)}` : "";
  const res = await fetch(`${API_BASE}/s/${token}/download?path=${qpath(path)}${q}`, { cache: "no-store" });
  if (!res.ok) {
    const data = await readBody(res);
    throw new ApiError(res.status, detailOf(data, res.statusText));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function shareUpload(
  token: string,
  path: string,
  name: string,
  body: Blob,
  pass: string,
): Promise<void> {
  const q = pass ? `&pass=${encodeURIComponent(pass)}` : "";
  const res = await fetch(
    `${API_BASE}/s/${token}/upload?path=${qpath(path)}&name=${encodeURIComponent(name)}${q}`,
    { method: "PUT", body, cache: "no-store" },
  );
  if (!res.ok) {
    const data = await readBody(res);
    throw new ApiError(res.status, detailOf(data, res.statusText));
  }
}

// --- activity feed (фаза 3) ---
// Append-only одит на пространството. `verb` е машинен низ (created/updated/…),
// а преводът е на фронтенда по ключ `activity.verb_*` — така нов език не пипа
// базата, а стари редове не „изчезват" при нов превод. `at` е ISO, изчислен
// на сървъра (клиентът не бива да гадае часовата зона на записа).
export type ActivityItem = {
  id: number;
  workspace_id: number;
  actor_id: number;
  actor_email: string;
  actor_name: string;
  verb: string;
  node_id: number;
  path: string;
  meta?: unknown;
  ts: number;
  at?: string;
};

export type ActivityList = {
  workspace_id: number;
  scope: "workspace" | "path" | "actor";
  limit: number;
  path: string;
  actor_id: number;
  items: ActivityItem[];
  count: number;
};

// `path` филтрира към възел и поддървото му (панелът „История" на файл);
// `actor_id` — „какво е правил Иван". Двете са взаимно изключващи се в API-то
// (пътят печели), затова подаваме само едното.
export type ChatMessage = {
  id: number;
  workspace_id: number;
  room: string;
  author_id: number;
  author_email: string;
  author_name: string;
  text: string;
  ts: number;
};

export type ChatList = {
  workspace_id: number;
  room: string;
  limit: number;
  items: ChatMessage[];
  count: number;
};

export async function listChat(limit = 50): Promise<ChatList> {
  return request<ChatList>(`/v1/chat?limit=${limit}`, "GET");
}

export async function postChat(text: string): Promise<ChatMessage> {
  return request<ChatMessage>("/v1/chat", "POST", { text });
}

export async function listActivity(opts: { path?: string; actorId?: number; limit?: number } = {}): Promise<ActivityList> {
  const parts: string[] = [];
  if (opts.limit) parts.push(`limit=${opts.limit}`);
  if (opts.path) parts.push(`path=${qpath(opts.path)}`);
  if (opts.actorId && opts.actorId > 0) parts.push(`actor_id=${opts.actorId}`);
  const q = parts.length > 0 ? `?${parts.join("&")}` : "";
  return request<ActivityList>(`/v1/activity${q}`, "GET");
}
