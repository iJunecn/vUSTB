'use client';

import { useEffect, useRef, useCallback } from 'react';
import { SkinViewer as SkinViewer3D, WalkingAnimation } from 'skinview3d';

type SkinViewerProps = {
  /** URL of the skin PNG image */
  skinUrl: string;
  /** URL of the cape PNG image (optional) */
  capeUrl?: string;
  /** Skin model type */
  model?: 'classic' | 'slim';
  /** Canvas width */
  width?: number;
  /** Canvas height */
  height?: number;
  /** Whether to auto-rotate */
  autoRotate?: boolean;
  /** Auto-rotate speed */
  autoRotateSpeed?: number;
  /** Whether to show walking animation */
  animate?: boolean;
  /** Animation speed */
  animationSpeed?: number;
  /** Zoom level */
  zoom?: number;
  /** Additional CSS class */
  className?: string;
};

/**
 * React wrapper for skinview3d SkinViewer.
 * Ported from vSkin's Vue SkinViewer.vue component.
 *
 * Renders a 3D Minecraft skin preview with optional cape, auto-rotation, and walking animation.
 */
export function SkinViewer({
  skinUrl,
  capeUrl,
  model = 'classic',
  width = 300,
  height = 400,
  autoRotate = true,
  autoRotateSpeed = 0.5,
  animate = true,
  animationSpeed = 0.5,
  zoom = 0.8,
  className,
}: SkinViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<SkinViewer3D | null>(null);

  const initViewer = useCallback(() => {
    const container = containerRef.current;
    if (!container || !skinUrl || viewerRef.current) return;

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
      skin: skinUrl,
      cape: capeUrl || undefined,
      model: model === 'slim' ? 'slim' : 'default',
    });

    viewer.autoRotate = autoRotate;
    viewer.autoRotateSpeed = autoRotateSpeed;
    viewer.zoom = zoom;

    if (animate) {
      viewer.animation = new WalkingAnimation();
      viewer.animation.speed = animationSpeed;
    }

    viewerRef.current = viewer;
  }, [skinUrl, capeUrl, model, width, height, autoRotate, autoRotateSpeed, animate, animationSpeed, zoom]);

  useEffect(() => {
    initViewer();

    return () => {
      if (viewerRef.current) {
        viewerRef.current.dispose();
        viewerRef.current = null;
      }
    };
  }, [initViewer]);

  // Update skin when URL changes
  useEffect(() => {
    if (viewerRef.current && skinUrl) {
      viewerRef.current.loadSkin(skinUrl, { model: model === 'slim' ? 'slim' : 'default' });
    }
  }, [skinUrl, model]);

  // Update cape when URL changes
  useEffect(() => {
    if (viewerRef.current) {
      if (capeUrl) {
        viewerRef.current.loadCape(capeUrl);
      } else {
        viewerRef.current.resetCape();
      }
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

/**
 * Compact skin preview - smaller version for cards and grids.
 */
export function SkinPreview({
  skinUrl,
  model = 'classic',
  size = 120,
}: {
  skinUrl: string;
  model?: 'classic' | 'slim';
  size?: number;
}) {
  return (
    <SkinViewer
      skinUrl={skinUrl}
      model={model}
      width={size}
      height={Math.round(size * 1.3)}
      autoRotate={false}
      animate={false}
      zoom={0.6}
    />
  );
}
