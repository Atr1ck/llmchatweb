import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

const ImageWorkspacePage = React.lazy(() => import("./pages/ImageWorkspacePage").then(({ ImageWorkspacePage: page }) => ({ default: page })));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">正在加载 Canvas Flow…</div>}>
      <ImageWorkspacePage />
    </Suspense>
  </React.StrictMode>
);
