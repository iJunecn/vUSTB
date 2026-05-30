'use client';

import { useEffect, useRef, useCallback } from 'react';
import { SkinViewer as SkinViewer3D } from 'skinview3d';

type CapeViewerProps = {
  /** URL of the cape PNG image */
  capeUrl: string;
  /** Canvas width */
  width?: number;
  /** Canvas height */
  height?: number;
  /** Whether to auto-rotate */
  autoRotate?: boolean;
  /** Auto-rotate speed */
  autoRotateSpeed?: number;
  /** Zoom level */
  zoom?: number;
  /** Additional CSS class */
  className?: string;
};

/**
 * React wrapper for skinview3d cape-only preview.
 * Ported from vSkin's Vue CapeViewer.vue component.
 *
 * Shows only the cape without a player model.
 */
export function CapeViewer({
  capeUrl,
  width = 200,
  height = 280,
  autoRotate = true,
  autoRotateSpeed = 0.5,
  zoom = 1.2,
  className,
}: CapeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer3D | null>(null);

  const initViewer = useCallback(() => {
    const container = containerRef.current;
    if (!container || !capeUrl || viewerRef.current) return;

    // Remove any existing canvas
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    const viewer = new SkinViewer3D({
      canvas,
      width,
      height,
      cape: capeUrl,
    } as any);

    // Hide the skin model, only show cape
    if (viewer.playerObject) {
      viewer.playerObject.skin.visible = false;
    }

    viewer.autoRotate = autoRotate;
    viewer.autoRotateSpeed = autoRotateSpeed;
    viewer.zoom = zoom;

    viewerRef.current = viewer;
  }, [capeUrl, width, height, autoRotate, autoRotateSpeed, zoom]);

  useEffect(() => {
    initViewer();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, [initViewer]);

  // Update cape when URL changes
  useEffect(() => {
    if (viewerRef.current && capeUrl) {
      viewerRef.current.loadCape(capeUrl);
    }
  }, [capeUrl]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--color-background-mute)',
      }}
    />
  );
}
