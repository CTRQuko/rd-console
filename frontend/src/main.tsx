// ESM bootstrap (Etapa 4, PR 1). Replaces the previous flow where
// index.html loaded React + Babel from CDNs and Babel-compiled every
// .jsx in the browser. Vite now bundles everything during dev (with
// real HMR) and during `npm run build` (optimised production bundle).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root not found in index.html");
}
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
