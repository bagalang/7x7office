"use client";

import { FileBrowser } from "../components/FileBrowser";
import { RequireAuth } from "../components/RequireAuth";

export default function HomePage() {
  return (
    <RequireAuth>
      <FileBrowser />
    </RequireAuth>
  );
}
