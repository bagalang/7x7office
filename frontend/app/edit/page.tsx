"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RequireAuth } from "../../components/RequireAuth";
import { DocEditor } from "../../components/DocEditor";
import { SheetEditor } from "../../components/SheetEditor";
import { ApiError, DocContent, loadDoc } from "../../lib/api";

function EditorScreen() {
  const params = useSearchParams();
  const path = params.get("path") ?? "/";
  const [doc, setDoc] = useState<DocContent | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancel = false;
    setDoc(null);
    setError("");
    loadDoc(path)
      .then((d) => {
        if (!cancel) setDoc(d);
      })
      .catch((err: unknown) => {
        if (!cancel) {
          setError(err instanceof ApiError ? err.message : "документът не се отваря");
        }
      });
    return () => {
      cancel = true;
    };
  }, [path]);

  if (error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="err">{error}</p>
          <p style={{ textAlign: "center" }}>
            <Link href="/">← Към файловете</Link>
          </p>
        </div>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="login-wrap">
        <p className="muted">Отваряне на {path}…</p>
      </div>
    );
  }
  if (doc.kind === "legacy") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="err">
            Старият формат „.{doc.format}“ е само за четене. Конвертирайте в .docx/.xlsx, за да
            редактирате.
          </p>
          <p style={{ textAlign: "center" }}>
            <Link href="/">← Към файловете</Link>
          </p>
        </div>
      </div>
    );
  }
  if (doc.kind === "sheet") {
    return <SheetEditor doc={doc} />;
  }
  return <DocEditor doc={doc} />;
}

export default function EditPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<p className="muted">Зареждане…</p>}>
        <EditorScreen />
      </Suspense>
    </RequireAuth>
  );
}
