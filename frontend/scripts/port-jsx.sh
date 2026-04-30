#!/usr/bin/env bash
# Mechanical port: .jsx → .tsx with React-globals → ESM imports.
# Usage: bash scripts/port-jsx.sh <relative-source-jsx> <relative-target-tsx>
set -euo pipefail

SRC=$1
DST=$2

# 1. Detect aliases in the source. Pattern: const { useState: _xxS, ... } = React;
ALIASES=$(grep -oE 'use[A-Z][a-z]+: _[a-z]{2}[A-Z]' "$SRC" | sort -u || true)

# 2. Read source, strip the aliases destructuring line, replace each
# alias with the bare hook name.
sed -E '/^const \{ useState:.*\} = React;$/d' "$SRC" > "$DST.tmp"

# 3. Replace each `_xxX` alias with the matching hook.
sed -E -i \
  -e 's/\b_[a-z]{2}S\b/useState/g' \
  -e 's/\b_[a-z]{2}E\b/useEffect/g' \
  -e 's/\b_[a-z]{2}M\b/useMemo/g' \
  -e 's/\b_[a-z]{2}C\b/useCallback/g' \
  -e 's/\b_[a-z]{2}R\b/useRef/g' \
  "$DST.tmp"

# 4. Drop `window.XYZ = XYZ;` lines (the page is exported below).
sed -E -i '/^window\.[A-Z][a-zA-Z]+ = [A-Z][a-zA-Z]+;?$/d' "$DST.tmp"

# 5. Find the page name (last function ending in `Page`) so we can
# add `export` in front of it.
PAGE_FN=$(grep -oE '^function [A-Z][a-zA-Z]+Page' "$DST.tmp" | head -1 | awk '{print $2}')
if [ -n "${PAGE_FN:-}" ]; then
  sed -E -i "s/^function ${PAGE_FN}\b/export function ${PAGE_FN}/" "$DST.tmp"
fi

# 6. Prepend the standard imports header.
mkdir -p "$(dirname "$DST")"
{
  echo "// @ts-nocheck"
  echo "// Mechanically ported from public/console/pages/$(basename "$SRC")"
  echo "// (Etapa 4 ESM migration). React aliases → bare hook names,"
  echo "// window.X exports → named ESM exports. ts-nocheck because the"
  echo "// legacy code wasn't typed; tightening up types is a follow-up."
  echo "import {"
  echo "  useState, useEffect, useMemo, useCallback, useRef,"
  echo "} from \"react\";"
  echo "import { Icon } from \"../components/Icon\";"
  echo "import {"
  echo "  Tag, Dot, Switch, Tabs, EmptyState, Skeleton, ErrorBanner,"
  echo "  Drawer, Modal, ConfirmDialog, PageSizeSelect, PageHeader,"
  echo "  ToastProvider, useToast, useHashRoute,"
  echo "} from \"../components/primitives\";"
  echo ""
  cat "$DST.tmp"
} > "$DST"

rm "$DST.tmp"
echo "ported: $SRC → $DST  ($(wc -l < "$DST") lines, page=${PAGE_FN:-NONE})"
