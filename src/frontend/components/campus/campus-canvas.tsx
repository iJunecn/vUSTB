'use client';

import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

type CampusCanvasProps = {
  onEngineReady?: () => void;
};

export function CampusCanvas({ onEngineReady }: CampusCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    animId: number;
  } | null>(null);

  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container || engineRef.current) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 80, 300);

    // Camera
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.5, 2000);
    camera.position.set(40, 30, 60);
    camera.lookAt(0, 0, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
    sun.position.set(50, 80, 40);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 300;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    scene.add(sun);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, 400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a8c3f,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Road (light gray strip)
    const roadGeo = new THREE.PlaneGeometry(8, 300);
    const roadMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.95 });
    const roadNS = new THREE.Mesh(roadGeo, roadMat);
    roadNS.rotation.x = -Math.PI / 2;
    roadNS.position.y = 0.02;
    scene.add(roadNS);

    const roadEW = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 8),
      roadMat.clone()
    );
    roadEW.rotation.x = -Math.PI / 2;
    roadEW.position.y = 0.02;
    scene.add(roadEW);

    // Building data: approximate USTB campus buildings
    const buildings = [
      // Main teaching buildings along the central axis
      { x: 0, z: -30, w: 20, h: 18, d: 14, color: 0xd4c5a9 },   // 主楼
      { x: -25, z: -10, w: 12, h: 12, d: 10, color: 0xc8b896 },  // 机电信息楼
      { x: 25, z: -10, w: 12, h: 12, d: 10, color: 0xc8b896 },   // 逸夫楼
      { x: -25, z: 20, w: 14, h: 10, d: 12, color: 0xbfb08a },   // 科技楼
      { x: 25, z: 20, w: 14, h: 10, d: 12, color: 0xbfb08a },    // 图书馆
      { x: 0, z: 30, w: 16, h: 8, d: 12, color: 0xd2c2a5 },     // 体育馆
      { x: -40, z: -30, w: 10, h: 8, d: 10, color: 0xc0a880 },   // 实验楼
      { x: 40, z: -30, w: 10, h: 8, d: 10, color: 0xc0a880 },    // 教学楼
      { x: -40, z: 0, w: 10, h: 14, d: 8, color: 0xbaa478 },     // 计算机楼
      { x: 40, z: 0, w: 10, h: 14, d: 8, color: 0xbaa478 },      // 材料楼
      // Dormitories
      { x: -50, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      { x: -38, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      { x: -26, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      { x: 50, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      { x: 38, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      { x: 26, z: 40, w: 8, h: 10, d: 8, color: 0xb0996e },
      // Additional structures
      { x: 0, z: -60, w: 24, h: 6, d: 6, color: 0xa89070 },     // 校门
      { x: -15, z: 55, w: 6, h: 4, d: 6, color: 0x99aa77 },     // 花园亭
      { x: 15, z: 55, w: 6, h: 4, d: 6, color: 0x99aa77 },      // 花园亭
    ];

    for (const b of buildings) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      const mat = new THREE.MeshStandardMaterial({
        color: b.color,
        roughness: 0.75,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      // Window rows
      if (b.h > 8) {
        const windowRows = Math.floor(b.h / 3.5);
        const windowCols = Math.max(2, Math.floor(b.w / 3));
        for (let row = 0; row < windowRows; row++) {
          for (let col = 0; col < windowCols; col++) {
            const winGeo = new THREE.PlaneGeometry(1.2, 1.6);
            const winMat = new THREE.MeshStandardMaterial({
              color: 0x8ecae6,
              roughness: 0.3,
              metalness: 0.1,
              emissive: 0x3a6a8a,
              emissiveIntensity: 0.15,
            });
            const winMesh = new THREE.Mesh(winGeo, winMat);
            const xOffset = -b.w / 2 + 2 + col * (b.w - 4) / Math.max(1, windowCols - 1);
            const yOffset = 2 + row * 3.2;
            // Front face
            winMesh.position.set(
              b.x + xOffset,
              yOffset,
              b.z + b.d / 2 + 0.01
            );
            scene.add(winMesh);
            // Back face
            const winBack = winMesh.clone();
            winBack.position.z = b.z - b.d / 2 - 0.01;
            winBack.rotation.y = Math.PI;
            scene.add(winBack);
          }
        }
      }
    }

    // Trees
    const treeTrunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 4, 8);
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const treeLeafGeo = new THREE.SphereGeometry(2.5, 8, 6);
    const treeLeafMat = new THREE.MeshStandardMaterial({ color: 0x2d7a2d });

    const treePositions = [
      [-10, -50], [10, -50], [-10, -20], [10, -20],
      [-35, 10], [35, 10], [-35, 30], [35, 30],
      [-60, -20], [60, -20], [-60, 20], [60, 20],
      [-8, 50], [8, 50], [-20, 65], [20, 65],
      [-55, 50], [55, 50], [-45, -45], [45, -45],
    ];

    for (const [tx, tz] of treePositions) {
      const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
      trunk.position.set(tx, 2, tz);
      trunk.castShadow = true;
      scene.add(trunk);

      const leaves = new THREE.Mesh(treeLeafGeo, treeLeafMat);
      leaves.position.set(tx, 5.5, tz);
      leaves.castShadow = true;
      scene.add(leaves);
    }

    // Animation loop
    const animate = () => {
      const id = requestAnimationFrame(animate);
      engineRef.current!.animId = id;
      renderer.render(scene, camera);
    };
    animate();

    engineRef.current = { renderer, scene, camera, animId: 0 };

    // Camera controls via mouse
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let theta = Math.atan2(camera.position.x, camera.position.z);
    let phi = Math.acos(camera.position.y / camera.position.length());
    let radius = camera.position.length();

    const target = new THREE.Vector3(0, 5, 0);

    function updateCamera() {
      camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
      camera.lookAt(target);
    }

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      theta -= dx * 0.005;
      phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.005));
      prevX = e.clientX;
      prevY = e.clientY;
      updateCamera();
    };
    const onMouseUp = () => { isDragging = false; };
    const onWheel = (e: WheelEvent) => {
      radius = Math.max(10, Math.min(200, radius + e.deltaY * 0.05));
      updateCamera();
    };

    // Touch controls
    let touchStartDist = 0;
    let touchStartRadius = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging = true;
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchStartDist = Math.sqrt(dx * dx + dy * dy);
        touchStartRadius = radius;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - prevX;
        const dy = e.touches[0].clientY - prevY;
        theta -= dx * 0.005;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi - dy * 0.005));
        prevX = e.touches[0].clientX;
        prevY = e.touches[0].clientY;
        updateCamera();
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const scale = touchStartDist / dist;
        radius = Math.max(10, Math.min(200, touchStartRadius * scale));
        updateCamera();
      }
    };
    const onTouchEnd = () => { isDragging = false; };

    renderer.domElement.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd);

    // Resize
    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    (renderer.domElement as HTMLCanvasElement & {
      _cleanup: () => void;
    })._cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onResize);
    };

    onEngineReady?.();
  }, [onEngineReady]);

  useEffect(() => {
    // Small delay to let container mount
    const timer = setTimeout(init, 100);
    return () => {
      clearTimeout(timer);
      if (engineRef.current) {
        cancelAnimationFrame(engineRef.current.animId);
        const canvas = engineRef.current.renderer.domElement;
        if ((canvas as HTMLCanvasElement & { _cleanup?: () => void })._cleanup) {
          (canvas as HTMLCanvasElement & { _cleanup: () => void })._cleanup();
        }
        engineRef.current.renderer.dispose();
        engineRef.current.scene.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        });
        engineRef.current = null;
      }
    };
  }, [init]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        cursor: 'grab',
      }}
    />
  );
}
