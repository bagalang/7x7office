import { readStorage, writeStorage } from "./storage";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
export const TOKEN_KEY = "secp.token";

export function getToken(): string | null {
  return readStorage(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  writeStorage(TOKEN_KEY, token);
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

export async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
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
    request<{ kind: string; text: string }>(`/v1/fs/preview?path=${qpath(path)}`, "GET"),
};

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
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
  const res = await authedFetch(`/v1/fs/file?path=${qpath(path)}`, { method: "PUT", body });
  const data = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, detailOf(data, res.statusText));
  return data as FsNode;
}

export async function downloadFile(node: FsNode): Promise<void> {
  const res = await authedFetch(`/v1/fs/file?path=${qpath(node.path)}`);
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
  return request<DocContent>(`/v1/doc/load?path=${qpath(path)}`, "GET");
}

// The editor sends the etag it loaded; on a mismatch the backend stores the
// new content as a `.conflict-*` copy and answers 409 instead of overwriting.
export async function saveDoc(path: string, text: string, etag?: string): Promise<FsNode> {
  const q = etag ? `&etag=${encodeURIComponent(etag)}` : "";
  const res = await authedFetch(`/v1/doc/save?path=${qpath(path)}${q}`, {
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
  return request<ZipList>(`/v1/fs/zip/list?path=${qpath(path)}`, "GET");
}

export async function downloadZipEntry(node: FsNode, entry: string): Promise<void> {
  const res = await authedFetch(`/v1/fs/zip/get?path=${qpath(node.path)}&entry=${encodeURIComponent(entry)}`);
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
  return request<FsVersionList>(`/v1/fs/versions?path=${qpath(path)}`, "GET");
}

export async function restoreVersion(path: string, version: number): Promise<FsNode> {
  return request<FsNode>(`/v1/fs/version/restore?path=${qpath(path)}&version=${version}`, "POST");
}

export async function downloadVersion(node: FsNode, version: number): Promise<void> {
  const res = await authedFetch(`/v1/fs/version/get?path=${qpath(node.path)}&version=${version}`);
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
