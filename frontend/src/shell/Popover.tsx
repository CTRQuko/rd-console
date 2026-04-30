// Generic popover anchored to a trigger element's bounding rect.
// Closes on Escape and on click outside. Used by both the topbar
// notifications panel and the user menu.
import { useEffect, type ReactNode } from "react";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRect: DOMRect | null;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
}

export function Popover({
  open,
  onClose,
  anchorRect,
  children,
  width = 360,
  align = "right",
}: PopoverProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  const top = anchorRect.bottom + 8;
  const right =
    align === "right" ? Math.max(8, window.innerWidth - anchorRect.right) : undefined;
  const left = align === "left" ? anchorRect.left : undefined;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top,
          right,
          left,
          width,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 16px 48px rgba(0,0,0,.22)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
