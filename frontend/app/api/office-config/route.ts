// Адресът на редактора идва от discovery на Collabora. Чете се при заявка,
// за да може COLLABORA_URL да се смени без ново компилиране на страницата.

import { discoveryUrlsrc } from "../../../lib/office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function collaboraBase(): string {
  const raw = process.env.COLLABORA_URL ?? "";
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed || "http://127.0.0.1:9980";
}

export async function GET(req: Request) {
  const ext = new URL(req.url).searchParams.get("ext")?.toLowerCase() ?? "";
  const base = collaboraBase();
  try {
    const res = await fetch(`${base}/hosting/discovery`, { cache: "no-store" });
    if (!res.ok) {
      return Response.json({ error: "discovery" }, { status: 502 });
    }
    const xml = await res.text();
    const urlsrc = discoveryUrlsrc(xml, ext);
    if (!urlsrc) {
      return Response.json({ error: "no urlsrc" }, { status: 502 });
    }
    return Response.json({ url: base, urlsrc });
  } catch {
    return Response.json({ error: "unreachable" }, { status: 502 });
  }
}
