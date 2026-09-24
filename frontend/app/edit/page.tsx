"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { RequireAuth } from "../../components/RequireAuth";
import { DocEditor } from "../../components/DocEditor";
import { SheetEditor } from "../../components/SheetEditor";
import { useI18n } from "../../components/I18nProvider";
import { ApiError, DocContent, loadDoc } from "../../lib/api";

function EditorScreen() {
  const { t } = useI18n();
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
          setError(err instanceof ApiError ? err.message : t("edit.open_error"));
        }
      });
    return () => {
      cancel = true;
    };
  }, [path, t]);

  if (error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="err">{error}</p>
          <p style={{ textAlign: "center" }}>
            <Link href="/">{t("edit.back_to_files")}</Link>
          </p>
        </div>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="login-wrap">
        <p className="muted">{t("edit.opening", { path })}</p>
      </div>
    );
  }
  if (doc.kind === "legacy") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="err">{t("edit.legacy", { format: doc.format })}</p>
          <p style={{ textAlign: "center" }}>
            <Link href="/">{t("edit.back_to_files")}</Link>
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
  const { t } = useI18n();
  return (
    <RequireAuth>
      <Suspense fallback={<p className="muted">{t("edit.loading")}</p>}>
        <EditorScreen />
      </Suspense>
    </RequireAuth>
  );
}
