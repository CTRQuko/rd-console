/**
 * Pre-compile Babel JSX → plain JS for production.
 *
 * The dev experience uses @babel/standalone to transform every
 * <script type="text/babel"> in the browser at runtime — that costs
 * ~5s on cold load and burns CPU on every reload. For deploy we want
 * the JSX already turned into JS so the page just loads <script>.
 *
 * This script:
 *   1. Reads frontend/index.html, finds every <script type="text/babel">.
 *   2. Compiles the matching .jsx file to .js via esbuild (loader=jsx).
 *   3. Emits the .js files alongside their sources (frontend/dist/...).
 *   4. Generates a sibling dist/index.html that loads the .js variants
 *      and drops the babel-standalone CDN tag entirely.
 *
 * Usage:
 *   cd frontend
 *   node scripts/build-prod.mjs
 *
 * The output lives in frontend/dist/. To serve it, copy to the backend's
 * static-files dir or point any web server at it. The dev workflow
 * (npm run dev) is unaffected — index.html (the one with text/babel
 * scripts) keeps working as before.
 *
 * Hard requirement: every .jsx must already work with the in-browser
 * Babel runtime (i.e. relies on React/ReactDOM as window globals, not
 * ESM imports). This is the ZIP's house style and we keep it for prod.
 */

import { build } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "..");
const PUBLIC = path.join(FRONTEND, "public");
const DIST = path.join(FRONTEND, "dist");

const INDEX_HTML = path.join(FRONTEND, "index.html");
const BABEL_TAG_RE = /<script\s+(?:[^>]*\s)?type=["']text\/babel["'][^>]*>\s*<\/script>/g;
const BABEL_SRC_RE = /src=["']([^"']+\.jsx)["']/;
const BABEL_STANDALONE_RE = /<script[^>]*@babel\/standalone[^>]*><\/script>\s*/;

async function compileJsx(srcPath, outPath) {
  // esbuild's jsx loader handles plain class-syntax / hooks JSX without
  // needing a full Babel preset chain. Since the source files use React
  // as a window global (no `import React from 'react'`), we tell
  // esbuild to NOT inject the runtime — keep the output style identical
  // to what the in-browser Babel pipeline produces.
  await build({
    entryPoints: [srcPath],
    outfile: outPath,
    bundle: false,
    format: "iife",
    target: "es2020",
    loader: { ".jsx": "jsx" },
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    minify: false,
    sourcemap: false,
  });
}

async function main() {
  await fs.mkdir(DIST, { recursive: true });

  const html = await fs.readFile(INDEX_HTML, "utf8");
  const tags = html.match(BABEL_TAG_RE) || [];
  if (tags.length === 0) {
    console.error("No <script type=\"text/babel\"> tags found in index.html — aborting.");
    process.exit(1);
  }

  console.log(`Found ${tags.length} JSX scripts. Compiling…`);

  let newHtml = html;
  for (const tag of tags) {
    const srcMatch = tag.match(BABEL_SRC_RE);
    if (!srcMatch) continue;
    const relSrc = srcMatch[1].replace(/^\//, ""); // "/console/..." → "console/..."
    const srcPath = path.join(PUBLIC, relSrc);
    const outRel = relSrc.replace(/\.jsx$/, ".js");
    const outPath = path.join(DIST, outRel);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await compileJsx(srcPath, outPath);
    console.log(`  ✓ ${relSrc} → dist/${outRel}`);
    // Replace the tag in HTML with a plain <script src="…js">.
    const replacement = `<script src="/${outRel}"></script>`;
    newHtml = newHtml.replace(tag, replacement);
  }

  // Drop the babel-standalone CDN tag — no longer needed.
  newHtml = newHtml.replace(BABEL_STANDALONE_RE, "");

  // Copy CSS / fonts / assets verbatim. We only ever rewrite .jsx; the
  // rest of public/ is static and shipped as-is.
  await copyDir(PUBLIC, DIST, { skipJsx: true });

  await fs.writeFile(path.join(DIST, "index.html"), newHtml, "utf8");
  console.log(`\n✅ Prod bundle written to ${DIST}`);
  console.log("   Serve with any static file server and the panel boots without Babel.");
}

async function copyDir(srcDir, destDir, { skipJsx } = {}) {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(srcDir, e.name);
    const dest = path.join(destDir, e.name);
    if (e.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copyDir(src, dest, { skipJsx });
    } else if (e.isFile()) {
      if (skipJsx && src.endsWith(".jsx")) continue;
      await fs.copyFile(src, dest);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
