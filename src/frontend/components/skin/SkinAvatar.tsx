'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * SkinAvatar — extracts the head (face) from a Minecraft skin PNG
 * and renders it as a small square avatar image.
 *
 * Uses a hidden <canvas> to crop the 8×8 head region (with hat overlay)
 * from the skin texture, then scales it up with nearest-neighbor.
 *
 * Ported from vSkin's avatar extraction logic.
 */
export function SkinAvatar({
  skinUrl,
  size = 32,
  className,
  style,
}: {
  skinUrl: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!skinUrl || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const w = img.width;
      const h = img.height;
      if (w < 64 || h < 32 || w % 64 !== 0) return;

      const scale = w / 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;

      // Draw base face: (8,8) to (16,16) — 8x8 region
      ctx.drawImage(
        img,
        8 * scale, 8 * scale, 8 * scale, 8 * scale,
        0, 0, size, size,
      );

      // Draw hat overlay: (40,8) to (48,16) — only if 64x64 format
      if (h >= 16 * scale && w >= 48 * scale) {
        ctx.drawImage(
          img,
          40 * scale, 8 * scale, 8 * scale, 8 * scale,
          0, 0, size, size,
        );
      }

      setReady(true);
    };
    img.src = skinUrl;
  }, [skinUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={className}
      style={{
        display: ready ? 'block' : 'none',
        imageRendering: 'pixelated',
        width: size,
        height: size,
        ...style,
      }}
    />
  );
}
