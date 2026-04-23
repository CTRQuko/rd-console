/** Thin wrapper over `qrcode.toCanvas` so callers don't have to juggle
 *  imperative canvas refs. Re-renders only when `value` or `size`
 *  changes — the `qrcode` library is cheap but the redraw isn't free.
 *
 *  Error correction defaulted to `M` (medium) — good balance between
 *  density and tolerance to the kind of scanning conditions a phone
 *  over a laptop screen produces.
 */

import { useEffect, useRef } from 'react';
import QRLib from 'qrcode';

interface QRCodeProps {
  value: string;
  size?: number;
  /** Foreground colour. Defaults to black for maximum contrast. */
  fg?: string;
  /** Background colour. Defaults to white — needed for reliable scanning
   *  under low-contrast displays. Don't honour the dark theme here on
   *  purpose; QR scanners prefer white. */
  bg?: string;
  ariaLabel?: string;
}

export function QRCode({
  value,
  size = 180,
  fg = '#000000',
  bg = '#ffffff',
  ariaLabel,
}: QRCodeProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !value) return;
    let cancelled = false;
    QRLib.toCanvas(canvas, value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: fg, light: bg },
    }).catch(() => {
      // If the value is too long for the target error-correction level
      // the library rejects; clear the canvas so we don't show stale data.
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    });
    return () => {
      cancelled = true;
    };
  }, [value, size, fg, bg]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel ?? 'QR code'}
      style={{ display: 'block', borderRadius: 4 }}
    />
  );
}
