// Mechanically ported from public/console/pages/Dashboard.edit.jsx
// (Etapa 4 ESM migration). Exports the dashboard editor primitives
// that Dashboard.tsx consumes.
//
// Now strictly typed (PR @ts-nocheck cleanup): the layout entries,
// catalog entries, and grid event handlers all carry types so the
// Grafana-style drag/resize/compact engine can be refactored
// without flying blind.
import {
  useState, useEffect, useMemo, useRef,
  Children,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "../components/Icon";

// ============================================================
// Dashboard Edit Mode — grid 12-col tipo Grafana
// ------------------------------------------------------------
// Wrapper que envuelve el Dashboard. Cuando edit=false renderiza
// un grid normal (12 col). Cuando edit=true permite:
//   - Drag para mover (snap a celda 12-col)
//   - Resize por esquina inferior-derecha (snap)
//   - Ocultar widget (×) → vuelve al catálogo
//   - Añadir widget desde el catálogo lateral
//   - Restaurar layout por defecto
// ------------------------------------------------------------
// 🔌 BACKEND CONTRACT
//   GET  /api/v1/dashboard/layout            → {layout: WidgetLayout[], updated_at}
//   PUT  /api/v1/dashboard/layout            ← {layout: WidgetLayout[]}
//   WidgetLayout = { id: string, x:0..11, y:int, w:1..12, h:1..2, hidden?:bool }
//   El layout se guarda POR USUARIO (cookie/Bearer auth).
//   El frontend cae a localStorage si el endpoint falla.
// ============================================================

// ─── Tipos públicos ──────────────────────────────────────────

export interface WidgetLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  pinned?: boolean;
}

export interface CatalogSize {
  w: number;
  h: number;
}

export type CatalogKind = "metric" | "chart" | "table" | "placeholder";

export interface CatalogEntry {
  id: string;
  label: string;
  icon: string;
  defaultSize: CatalogSize;
  kind: CatalogKind;
  fixedSize?: boolean;
  minSize?: CatalogSize;
  future?: boolean;
}

// Constantes del grid
const GRID_COLS = 12;
const ROW_HEIGHT = 75;     // px por fila — calibrado para que h:3 (slot
                           // 3*75+32=257px) ajuste al contenido natural
                           // del MetricCard (donut 140 + chip + padding ≈
                           // 226px), eliminando el whitespace vertical
                           // sobrante que aparecía con ROW_HEIGHT=90 (302).
const GRID_GAP = 16;       // px gap (coincide con CSS)
const STORAGE_KEY = "dashboard.layout.v2";

// Layout por defecto: 5 metrics en una fila (cada una 2-col, 2 filas alto)
// + charts grandes (12-col, 2 filas) + tabla recientes (12-col, 2 filas)
// Total cabe en 12 columnas: 2+2+2+2+4 = 12 (la última coge 4 para acomodar SLA + hueco).
// h:3 (no h:2) en las 5 metric cards: el donut declarado a 140 CSS
// se aplastaba a 120 dentro del slot de 2*90+16=196 px (padding 40 +
// chip 32 + gaps no dejan los 140 que el donut necesita). Con h:3 el
// slot pasa a 3*90+2*16=302 px y el donut respira.
export const DEFAULT_LAYOUT: WidgetLayout[] = [
  { id: "cpu",        x: 0,  y: 0, w: 2, h: 3 },
  { id: "memory",     x: 2,  y: 0, w: 2, h: 3 },
  { id: "sessions",   x: 4,  y: 0, w: 2, h: 3 },
  { id: "network",    x: 6,  y: 0, w: 2, h: 3 },
  { id: "sla",        x: 8,  y: 0, w: 2, h: 3 },
  { id: "histogram",  x: 0,  y: 3, w: 12, h: 3 },
  { id: "throughput", x: 0,  y: 6, w: 12, h: 3 },
  { id: "recent",     x: 0,  y: 9, w: 12, h: 4 },
];

// Whitelist de IDs de widget que el grid sabe renderizar. Si el blob
// de localStorage trae un id desconocido (corrupción, payload XSS,
// version drift), lo descartamos. Cierra VULN-12 del audit 2026-05-01.
const KNOWN_WIDGET_IDS = new Set<string>([
  "cpu", "memory", "sessions", "network", "sla",
  "histogram", "throughput", "recent",
]);

const _isValidLayoutEntry = (entry: unknown): entry is WidgetLayout => {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.id === "string" && KNOWN_WIDGET_IDS.has(e.id) &&
    typeof e.x === "number" && Number.isFinite(e.x) && e.x >= 0 && e.x <= 12 &&
    typeof e.y === "number" && Number.isFinite(e.y) && e.y >= 0 && e.y <= 100 &&
    typeof e.w === "number" && Number.isFinite(e.w) && e.w >= 1 && e.w <= 12 &&
    typeof e.h === "number" && Number.isFinite(e.h) && e.h >= 1 && e.h <= 12 &&
    (e.hidden === undefined || typeof e.hidden === "boolean") &&
    (e.pinned === undefined || typeof e.pinned === "boolean")
  );
};

const loadLayout = (): WidgetLayout[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_LAYOUT;
    // Schema-validate cada entrada antes de aceptarla. Si una sola está
    // mal, descartamos todo el blob y volvemos al default — más seguro
    // que renderizar un layout corrupto.
    if (!parsed.every(_isValidLayoutEntry)) return DEFAULT_LAYOUT;
    return parsed as WidgetLayout[];
  } catch { return DEFAULT_LAYOUT; }
};
const saveLayout = (layout: WidgetLayout[]): void => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch {
    // localStorage might be unavailable (quota, private mode, etc.) — ignore.
  }
};

// Hook expuesto al DashboardPage
export interface UseDashboardLayoutReturn {
  layout: WidgetLayout[];
  edit: boolean;
  startEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  resetToDefault: () => void;
  setDraft: Dispatch<SetStateAction<WidgetLayout[]>>;
}

export function useDashboardLayout(): UseDashboardLayoutReturn {
  const [layout, setLayout] = useState<WidgetLayout[]>(loadLayout);
  const [edit, setEdit] = useState(false);
  const [draft, setDraftState] = useState<WidgetLayout[]>([]); // copia mientras edita

  const startEdit = () => { setDraftState(layout.map((w) => ({ ...w }))); setEdit(true); };
  const cancelEdit = () => { setDraftState([]); setEdit(false); };
  const saveEdit = () => {
    if (draft.length > 0) {
      setLayout(draft);
      saveLayout(draft);
    }
    setDraftState([]);
    setEdit(false);
  };
  const resetToDefault = () => { setDraftState(DEFAULT_LAYOUT.map((w) => ({ ...w }))); };

  const current = edit ? draft : layout;

  return {
    layout: current,
    edit,
    startEdit,
    cancelEdit,
    saveEdit,
    resetToDefault,
    setDraft: setDraftState,
  };
}

// ─── Helpers de catálogo ────────────────────
export const CATALOG: CatalogEntry[] = [
  { id: "cpu",        label: "CPU",         icon: "cpu",      defaultSize: { w: 2, h: 3 }, kind: "metric", fixedSize: true },
  { id: "memory",     label: "Memoria",     icon: "memory",   defaultSize: { w: 2, h: 3 }, kind: "metric", fixedSize: true },
  { id: "sessions",   label: "Sesiones",    icon: "link",     defaultSize: { w: 2, h: 3 }, kind: "metric", fixedSize: true },
  { id: "network",    label: "Red",         icon: "zap",      defaultSize: { w: 2, h: 3 }, kind: "metric", fixedSize: true },
  { id: "sla",        label: "SLA",         icon: "activity", defaultSize: { w: 2, h: 3 }, kind: "metric", fixedSize: true },
  { id: "histogram",  label: "Conexiones 24h", icon: "bar-chart", defaultSize: { w: 12, h: 3 }, kind: "chart", minSize: { w: 4, h: 3 } },
  { id: "throughput", label: "Tráfico de red", icon: "activity",  defaultSize: { w: 12, h: 3 }, kind: "chart", minSize: { w: 4, h: 3 } },
  { id: "recent",     label: "Conexiones recientes", icon: "list", defaultSize: { w: 12, h: 4 }, kind: "table" },
  // Placeholders futuros — el usuario los puede añadir vacíos
  { id: "placeholder-1", label: "Widget vacío",   icon: "plus", defaultSize: { w: 4, h: 2 }, kind: "placeholder", future: true },
  { id: "placeholder-2", label: "Widget vacío",   icon: "plus", defaultSize: { w: 4, h: 2 }, kind: "placeholder", future: true },
];

// ─── EditModeBar ────────────────────────────
interface EditModeBarProps {
  edit: boolean;
  layout: WidgetLayout[];
  onCancel: () => void;
  onSave: () => void;
  onReset: () => void;
  dirty?: boolean;
}

export function EditModeBar({ edit, onCancel, onSave, onReset }: EditModeBarProps) {
  if (!edit) return null;
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      display: "flex", alignItems: "center", gap: 10,
      padding: "6px 10px", marginBottom: 12,
      background: "color-mix(in oklab, var(--primary) 8%, var(--card))",
      border: "1px solid var(--primary)",
      borderRadius: 6,
      fontSize: 12,
    }}>
      <Icon name="edit" size={12} style={{ color: "var(--primary)" }} />
      <span style={{ fontWeight: 600 }}>Modo edición</span>
      <span style={{ color: "var(--fg-muted)", fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Arrastra · esquina ↘ resize · × oculta
      </span>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="cm-btn cm-btn--ghost cm-btn--sm" onClick={onReset} style={{ fontSize: 11, padding: "4px 8px" }}>
          <Icon name="refresh" size={11} /> Restaurar
        </button>
        <button className="cm-btn cm-btn--ghost cm-btn--sm" onClick={onCancel} style={{ fontSize: 11, padding: "4px 8px" }}>
          Cancelar
        </button>
        <button className="cm-btn cm-btn--primary cm-btn--sm" onClick={onSave} style={{ fontSize: 11, padding: "4px 10px" }}>
          Guardar
        </button>
      </div>
    </div>
  );
}

// ─── Catálogo lateral ───────────────────────
interface CatalogPanelProps {
  visibleIds: string[];
  onAdd: (entry: CatalogEntry) => void;
}

export function CatalogPanel({ visibleIds, onAdd }: CatalogPanelProps) {
  const hidden = CATALOG.filter((c) => !visibleIds.includes(c.id));
  if (hidden.length === 0) return null;
  return (
    <aside style={{
      width: 240, flexShrink: 0,
      alignSelf: "flex-start",
      position: "sticky", top: 56,
      maxHeight: "calc(100vh - 80px)",
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 10, boxShadow: "0 4px 12px rgba(0,0,0,.06)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--fg-muted)", fontWeight: 600 }}>
          Widgets disponibles
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
          Click para añadir al dashboard
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
        {hidden.map((c) => (
          <button
            key={c.id}
            onClick={() => onAdd(c)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "10px 12px", marginBottom: 4,
              background: "transparent", border: "1px dashed var(--border)",
              borderRadius: 6, cursor: "pointer", textAlign: "left",
              fontSize: 13, color: "var(--fg)",
              transition: "background .15s, border-color .15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-subtle)"; e.currentTarget.style.borderColor = "var(--primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "var(--border)"; }}
          >
            <Icon name={c.icon} size={14} style={{ color: "var(--fg-muted)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{c.label}</div>
              <div style={{ fontSize: 10, color: "var(--fg-muted)", fontFamily: "var(--font-mono)" }}>
                {c.defaultSize.w}×{c.defaultSize.h}{c.future ? " · vacío" : ""}
              </div>
            </div>
            <Icon name="plus" size={12} style={{ color: "var(--primary)" }} />
          </button>
        ))}
      </div>
    </aside>
  );
}

// ─── Motor de layout estilo Grafana ─────────
// Algoritmo:
// 1. La card draggeada se posiciona en (newX, newY)
// 2. Cualquier card que pise se empuja hacia abajo lo justo para no solaparse
// 3. Resolución en cascada: si A empuja a B y B pisa a C, C también se empuja
// 4. Compactación: todas las cards (excepto la draggeada) suben lo máximo posible
//    sin colisionar entre sí ni con la draggeada
const overlapsRect = (a: WidgetLayout, b: WidgetLayout): boolean =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

function resolveCollisions(layout: WidgetLayout[], movedId: string): WidgetLayout[] {
  // Empuja hacia abajo cualquier card que pise a la movedId,
  // luego cualquier card que pisen las desplazadas, etc.
  // Cards con `pinned: true` NUNCA se mueven — en su lugar, la moved se desplaza.
  const out = layout.map((w) => ({ ...w }));
  const moved = out.find((w) => w.id === movedId);
  if (!moved) return out;

  // Paso 1: si moved choca con alguna pinned, empuja moved hasta que no colisione
  let safety = 0;
  while (safety++ < 100) {
    const blocker = out.find((p) => p.id !== movedId && p.pinned && overlapsRect(moved, p));
    if (!blocker) break;
    moved.y = blocker.y + blocker.h;
  }

  let changed = true;
  let iter = 0;
  while (changed && iter < 50) {
    changed = false;
    iter++;
    for (const a of out) {
      if (a.id === movedId) continue;
      if (a.pinned) continue; // pinned no se mueve nunca
      for (const b of out) {
        if (a.id === b.id) continue;
        if (a.id !== movedId && b.id !== movedId) continue;
        if (overlapsRect(a, b)) {
          const target = (b.id === movedId ? b : a);
          const pushed = (b.id === movedId ? a : b);
          if (pushed.pinned) continue; // no empujar pinneds
          const newY = target.y + target.h;
          if (pushed.y < newY) {
            pushed.y = newY;
            changed = true;
          }
        }
      }
    }
    // Cascada entre no-moved
    for (const a of out) {
      if (a.id === movedId) continue;
      if (a.pinned) continue;
      for (const b of out) {
        if (a.id === b.id || b.id === movedId) continue;
        if (overlapsRect(a, b) && a.y < b.y + b.h && a.y >= b.y) {
          const newY = b.y + b.h;
          if (a.y < newY) { a.y = newY; changed = true; }
        }
      }
    }
  }
  return out;
}

function compactLayout(layout: WidgetLayout[], pinnedId: string): WidgetLayout[] {
  // Sube cada card (excepto pinnedId si está draggeando, o pinned=true) lo máximo posible
  // sin colisionar.
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: WidgetLayout[] = [];
  for (const w of sorted) {
    if (w.id === pinnedId || w.pinned) {
      placed.push({ ...w });
      continue;
    }
    // Buscar la y mínima donde no colisione con ninguna ya colocada
    let y = 0;
    while (true) {
      const test = { ...w, y };
      const hit = placed.some((p) => overlapsRect(test, p));
      if (!hit) break;
      y++;
    }
    placed.push({ ...w, y });
  }
  return placed;
}

// ─── Grid wrapper ───────────────────────────
// Renderiza children en un grid 12-col. Los hijos deben tener `data-widget-id`
// y se posicionan con grid-column / grid-row.

interface DragState {
  id: string;
  mode: "move" | `resize-${string}`;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  original: WidgetLayout;
  snapshot: WidgetLayout[];
}

interface DashboardGridProps {
  layout: WidgetLayout[];
  edit: boolean;
  onChange: Dispatch<SetStateAction<WidgetLayout[]>>;
  children: ReactNode;
}

export function DashboardGrid({ layout, edit, onChange, children }: DashboardGridProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const childrenById = useMemo(() => {
    const map: Record<string, ReactNode> = {};
    Children.forEach(children, (ch) => {
      // React children may be primitives — only the elements with the
      // `data-widget-id` prop interest us.
      if (
        ch &&
        typeof ch === "object" &&
        "props" in ch &&
        ch.props &&
        typeof ch.props === "object" &&
        "data-widget-id" in ch.props &&
        typeof (ch.props as Record<string, unknown>)["data-widget-id"] === "string"
      ) {
        const widgetId = (ch.props as Record<string, unknown>)["data-widget-id"] as string;
        map[widgetId] = ch;
      }
    });
    return map;
  }, [children]);

  const onPointerDown = (
    e: ReactPointerEvent<HTMLElement>,
    id: string,
    mode: "move" | `resize-${string}`,
  ) => {
    if (!edit) return;
    const w = layout.find((l) => l.id === id);
    if (!w) return;
    if (w.pinned) return; // pinned cards no se mueven ni redimensionan
    const catEntry = CATALOG.find((c) => c.id === id);
    const isResize = mode.startsWith("resize");
    if (isResize && catEntry?.fixedSize) return;
    e.preventDefault();
    e.stopPropagation();
    const targetEl = e.currentTarget;
    const cardEl = isResize ? targetEl.closest('[data-widget-card="true"]') : targetEl;
    const rect = (cardEl ?? targetEl).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    setDrag({
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      offsetX,
      offsetY,
      original: { ...w },
      snapshot: layout.map((x) => ({ ...x })),
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const colWidth = (rect.width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const dCols = Math.round(dx / (colWidth + GRID_GAP));
      const dRows = Math.round(dy / (ROW_HEIGHT + GRID_GAP));

      onChange(() => {
        const baseLayout = drag.snapshot.map((w) => ({ ...w }));
        const me = baseLayout.find((w) => w.id === drag.id);
        if (!me) return baseLayout;

        if (drag.mode.startsWith("resize")) {
          const dir = drag.mode.slice("resize-".length); // n,s,e,w,ne,nw,se,sw
          const o = drag.original;
          const dragCat = CATALOG.find((c) => c.id === drag.id);
          const minW = dragCat?.minSize?.w ?? 1;
          const minH = dragCat?.minSize?.h ?? 1;
          let newX = o.x;
          let newY = o.y;
          let newW = o.w;
          let newH = o.h;
          if (dir.includes("e")) newW = Math.max(minW, Math.min(GRID_COLS - o.x, o.w + dCols));
          if (dir.includes("w")) {
            const maxShrink = o.w - minW;
            const dxClamped = Math.max(-o.x, Math.min(maxShrink, dCols));
            newX = o.x + dxClamped;
            newW = o.w - dxClamped;
          }
          if (dir.includes("s")) newH = Math.max(minH, Math.min(8, o.h + dRows));
          if (dir.includes("n")) {
            const maxShrinkY = o.h - minH;
            const dyClamped = Math.max(-o.y, Math.min(maxShrinkY, dRows));
            newY = o.y + dyClamped;
            newH = o.h - dyClamped;
          }
          const next = baseLayout.map((w) =>
            w.id === drag.id ? { ...w, x: newX, y: newY, w: newW, h: newH } : w,
          );
          const resolved = resolveCollisions(next, drag.id);
          return compactLayout(resolved, drag.id);
        }

        // MOVE
        const newX = Math.max(0, Math.min(GRID_COLS - drag.original.w, drag.original.x + dCols));
        const newY = Math.max(0, drag.original.y + dRows);

        if (newX === drag.original.x && newY === drag.original.y) return baseLayout;

        const next = baseLayout.map((w) =>
          w.id === drag.id ? { ...w, x: newX, y: newY } : w,
        );
        const resolved = resolveCollisions(next, drag.id);
        return compactLayout(resolved, drag.id);
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, onChange]);

  // Total filas (para el alto del grid)
  const totalRows = Math.max(...layout.map((w) => w.y + w.h), 8);

  // Tamaño del contenedor para calcular celdas en píxeles
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    if (!gridRef.current) return;
    const el = gridRef.current;
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth);
    });
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const colWidth = containerWidth > 0 ? (containerWidth - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS : 0;
  const cellX = (col: number) => col * (colWidth + GRID_GAP);
  const cellY = (row: number) => row * (ROW_HEIGHT + GRID_GAP);
  const cellW = (w: number) => w * colWidth + (w - 1) * GRID_GAP;
  const cellH = (h: number) => h * ROW_HEIGHT + (h - 1) * GRID_GAP;

  // Posición libre del cursor para la card draggeada
  const [dragCursor, setDragCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!drag || drag.mode !== "move") { setDragCursor(null); return; }
    const onMove = (e: PointerEvent) => {
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      setDragCursor({
        x: e.clientX - rect.left - drag.offsetX,
        y: e.clientY - rect.top - drag.offsetY,
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [drag]);

  return (
    <div ref={gridRef} style={{
      position: "relative",
      width: "100%",
      height: cellY(totalRows) - GRID_GAP,
      // Overlay grid en modo edición
      ...(edit ? {
        backgroundImage: `repeating-linear-gradient(0deg, color-mix(in oklab, var(--primary) 6%, transparent) 0 ${ROW_HEIGHT}px, transparent ${ROW_HEIGHT}px ${ROW_HEIGHT + GRID_GAP}px), repeating-linear-gradient(90deg, color-mix(in oklab, var(--primary) 6%, transparent) 0 ${colWidth}px, transparent ${colWidth}px ${colWidth + GRID_GAP}px)`,
      } : {}),
    }}>
      {/* Ghost de la celda destino mientras se arrastra */}
      {edit && drag && drag.mode === "move" && (() => {
        const me = layout.find((l) => l.id === drag.id);
        if (!me) return null;
        return (
          <div style={{
            position: "absolute",
            left: cellX(me.x), top: cellY(me.y),
            width: cellW(me.w), height: cellH(me.h),
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            border: "2px dashed var(--primary)",
            borderRadius: 12,
            pointerEvents: "none",
            transition: "left .2s ease, top .2s ease, width .2s ease, height .2s ease",
            zIndex: 1,
          }}/>
        );
      })()}

      {layout.map((w) => {
        const child = childrenById[w.id];
        if (!child) return null;
        const catEntry = CATALOG.find((c) => c.id === w.id);
        const fixedSize = catEntry?.fixedSize;
        const isDragging = drag !== null && drag.id === w.id && drag.mode === "move";
        const isResizing = drag !== null && drag.id === w.id && drag.mode.startsWith("resize");
        const isActive = isDragging || isResizing;

        // Posición: si está en drag, sigue al cursor; si no, snap a celda
        const left = isDragging && dragCursor ? dragCursor.x : cellX(w.x);
        const top  = isDragging && dragCursor ? dragCursor.y : cellY(w.y);

        const cursorStyle = (() => {
          if (!edit) return "default";
          if (w.pinned) return "default";
          if (isDragging) return "grabbing";
          if (isResizing && drag) {
            const resizeDir = drag.mode.replace("resize-", "");
            return resizeDir.includes("e") || resizeDir.includes("w") ? "ew-resize" : "ns-resize";
          }
          return "grab";
        })();

        return (
          <div
            key={w.id}
            data-widget-card="true"
            style={{
              position: "absolute",
              left, top,
              width: cellW(w.w), height: cellH(w.h),
              minWidth: 0, minHeight: 0,
              borderRadius: 12,
              outline: edit ? (isDragging
                ? "2px solid var(--primary)"
                : "2px dashed color-mix(in oklab, var(--primary) 40%, transparent)") : "none",
              outlineOffset: -2,
              cursor: cursorStyle,
              transition: isActive
                ? "none"
                : "left .25s cubic-bezier(.4,0,.2,1), top .25s cubic-bezier(.4,0,.2,1), width .25s ease, height .25s ease, box-shadow .15s, transform .15s",
              zIndex: isActive ? 100 : 2,
              transform: isDragging ? "scale(1.02) rotate(-.5deg)" : "scale(1)",
              boxShadow: isActive
                ? "0 16px 40px rgba(0,0,0,.18), 0 4px 12px rgba(0,0,0,.10)"
                : "none",
              opacity: isDragging ? 0.92 : 1,
            }}
            onPointerDown={edit ? (e) => onPointerDown(e, w.id, "move") : undefined}
          >
            {/* Wrapper que bloquea interacciones internas en modo edición */}
            <div style={{
              width: "100%", height: "100%",
              display: "flex", flexDirection: "column",
              borderRadius: 12,
              pointerEvents: edit ? "none" : "auto",
              userSelect: edit ? "none" : "auto",
            }} className="cm-widget-fill">
              {child}
            </div>

            {edit && (
              <>
                {/* Pin / chincheta — fija la card para que no la mueva la compactación */}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange((prev) => prev.map((x) => x.id === w.id ? { ...x, pinned: !x.pinned } : x));
                  }}
                  style={{
                    position: "absolute", top: 6, left: 6, zIndex: 3,
                    width: 22, height: 22, borderRadius: "50%",
                    background: w.pinned ? "var(--primary)" : "var(--card)",
                    color: w.pinned ? "#fff" : "var(--fg-muted)",
                    border: "1px solid " + (w.pinned ? "var(--primary)" : "var(--border)"),
                    display: "grid", placeItems: "center", cursor: "pointer",
                    fontSize: 11,
                  }}
                  title={w.pinned ? "Desfijar" : "Fijar posición"}
                >📌</button>

                {/* Botón cerrar/ocultar */}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange((prev) => prev.filter((x) => x.id !== w.id));
                  }}
                  style={{
                    position: "absolute", top: 6, right: 6, zIndex: 3,
                    width: 22, height: 22, borderRadius: "50%",
                    background: "var(--card)", border: "1px solid var(--border)",
                    display: "grid", placeItems: "center", cursor: "pointer",
                    color: "var(--fg-muted)",
                  }}
                  title="Quitar widget"
                >×</button>

                {/* Handles de resize en 8 direcciones — solo si no es fixedSize ni pinned */}
                {!fixedSize && !w.pinned && (() => {
                  const HANDLES: { dir: string; cursor: string; style: CSSProperties }[] = [
                    { dir: "n",  cursor: "ns-resize",   style: { top: -3, left: 8, right: 8, height: 6 } },
                    { dir: "s",  cursor: "ns-resize",   style: { bottom: -3, left: 8, right: 8, height: 6 } },
                    { dir: "w",  cursor: "ew-resize",   style: { left: -3, top: 8, bottom: 8, width: 6 } },
                    { dir: "e",  cursor: "ew-resize",   style: { right: -3, top: 8, bottom: 8, width: 6 } },
                    { dir: "nw", cursor: "nwse-resize", style: { top: -3, left: -3, width: 12, height: 12 } },
                    { dir: "ne", cursor: "nesw-resize", style: { top: -3, right: -3, width: 12, height: 12 } },
                    { dir: "sw", cursor: "nesw-resize", style: { bottom: -3, left: -3, width: 12, height: 12 } },
                    { dir: "se", cursor: "nwse-resize", style: { bottom: -3, right: -3, width: 12, height: 12 } },
                  ];
                  return HANDLES.map((h) => (
                    <div
                      key={h.dir}
                      onPointerDown={(e) => onPointerDown(e, w.id, `resize-${h.dir}`)}
                      style={{
                        position: "absolute", zIndex: 4,
                        cursor: h.cursor,
                        ...h.style,
                      }}
                      title="Redimensionar"
                    />
                  ));
                })()}

                {/* Indicador visual de la esquina inferior derecha */}
                {!fixedSize && !w.pinned && (
                  <div style={{
                    position: "absolute", bottom: 0, right: 0, zIndex: 3,
                    width: 14, height: 14,
                    background: "linear-gradient(135deg, transparent 50%, var(--primary) 50%)",
                    borderBottomRightRadius: 12,
                    opacity: 0.5,
                    pointerEvents: "none",
                  }}/>
                )}

                {/* Etiqueta de tamaño */}
                <div style={{
                  position: "absolute", bottom: 6, left: 6,
                  fontSize: 10, fontFamily: "var(--font-mono)",
                  background: "var(--card)", border: "1px solid var(--border)",
                  padding: "2px 6px", borderRadius: 4, color: "var(--fg-muted)",
                  pointerEvents: "none", zIndex: 3,
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  {fixedSize && <span style={{ fontSize: 9 }}>🔒</span>}
                  {w.w}×{w.h}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
