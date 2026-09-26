"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireAuth } from "../../components/RequireAuth";
import { DocEditor } from "../../components/DocEditor";
import { SheetEditor } from "../../components/SheetEditor";
import { useI18n } from "../../components/I18nProvider";
import { ApiError, DocContent, loadDoc } from "../../lib/api";
import { isOfficeName, officeHref } from "../../lib/office";

function EditorScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const path = params.get("path") ?? "/";
  const [doc, setDoc] = useState<DocContent | null>(null);
  const [error, setError] = useState("");
  const office = isOfficeName(path);

  useEffect(() => {
    if (!office) return;
    router.replace(officeHref(path));
  }, [office, path, router]);

  useEffect(() => {
    if (office) return;
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
  }, [office, path, t]);

  if (office) {
    return (
      <div className="login-wrap">
        <p className="muted">{t("office.opening")}</p>
      </div>
    );
  }

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
