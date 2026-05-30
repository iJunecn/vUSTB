import type { Frustum } from '@render/core/scene/Frustum'

/**
 * [WIP — DISABLED] Section-level BFS visibility graph — Sodium-style implementation.
 *
 * Currently maintained but NOT used for culling in the WebGL2 backend.
 * Reasons:
 *  - Render granularity is cluster-level (128×128 XZ), not section-level.
 *    Without section-level multi-draw, BFS cannot cull individual sections.
 *  - All sections default to passthrough=0x3F (fully passable), which makes
 *    BFS reachability identical to brute-force — zero additional culling.
 *  - To become effective, requires:
 *    (a) Mesher-generated passthrough masks per section (Route A)
 *    (b) Section-level multi-draw / indexed indirect draw (Route B)
 *
 * Design reference: CaffeineMC/sodium (VisibleChunkCollector / SectionOcclusionGraph).
 */

export interface SectionNode {
  key: string
  chunkX: number
  sectionY: number
  chunkZ: number
  boundsMin: Float32Array
  boundsMax: Float32Array
  /** Bitmask: which of 6 faces allow light/visibility to pass through.
   *  Bit0=+X, Bit1=-X, Bit2=+Y, Bit3=-Y, Bit4=+Z, Bit5=-Z.
   *  0x3F = fully passable (conservative default). */
  passthrough: number
}

/** Direction vectors for 6-connected adjacency: +X, -X, +Y, -Y, +Z, -Z */
const DIR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], // +X (bit 0)
  [-1, 0, 0], // -X (bit 1)
  [0, 1, 0], // +Y (bit 2)
  [0, -1, 0], // -Y (bit 3)
  [0, 0, 1], // +Z (bit 4)
  [0, 0, -1], // -Z (bit 5)
]

/** Opposite face index for each direction */
const OPPOSITE_DIR = [1, 0, 3, 2, 5, 4]

const PASSTHROUGH_ALL = 0x3f

// World Y range: −64 → 320 (384 blocks, 24 sections)
const MIN_SECTION_Y = -4
const MAX_SECTION_Y = 19

export function sectionKeyFromCoords(chunkX: number, sectionY: number, chunkZ: number): string {
  return `${chunkX},${sectionY},${chunkZ}`
}

export interface VisibilityBFSResult {
  visibleSections: Set<string>
  /** Cluster keys that have at least one visible section */
  visibleClusters: Set<string>
  /** Geometry sections reachable from camera (via BFS, distance-limited) */
  reachableCount: number
  /** Total BFS steps including air traversal */
  bfsVisitedCount: number
  /** Total registered sections with geometry */
  totalCount: number
}

export class SectionVisibilityGraph {
  private readonly nodes = new Map<string, SectionNode>()
  private graphVersion = 0

  // --- BFS reachability cache (independent of frustum) ---
  private lastCamChunkX = NaN
  private lastCamSectionY = NaN
  private lastCamChunkZ = NaN
  private lastGraphVersion = -1
  private lastMaxDistSq = -1
  private cachedReachable: SectionNode[] | null = null
  private cachedBfsVisited = 0

  /** Register or update a section node. Call when sections are added/changed. */
  registerSection(
    chunkX: number,
    sectionY: number,
    chunkZ: number,
    boundsMin: Float32Array,
    boundsMax: Float32Array,
    passthrough: number = PASSTHROUGH_ALL,
  ): void {
    const key = sectionKeyFromCoords(chunkX, sectionY, chunkZ)
    const existing = this.nodes.get(key)
    if (existing) {
      existing.boundsMin = boundsMin
      existing.boundsMax = boundsMax
      existing.passthrough = passthrough
    } else {
      this.nodes.set(key, { key, chunkX, sectionY, chunkZ, boundsMin, boundsMax, passthrough })
    }
    this.graphVersion++
  }

  /** Remove a section from the graph. */
  removeSection(chunkX: number, sectionY: number, chunkZ: number): void {
    const key = sectionKeyFromCoords(chunkX, sectionY, chunkZ)
    if (this.nodes.delete(key)) {
      this.graphVersion++
    }
  }

  /** Remove all sections belonging to a chunk. */
  removeChunk(chunkX: number, chunkZ: number): void {
    const toDelete: string[] = []
    for (const node of this.nodes.values()) {
      if (node.chunkX === chunkX && node.chunkZ === chunkZ) {
        toDelete.push(node.key)
      }
    }
    for (const key of toDelete) {
      this.nodes.delete(key)
    }
    if (toDelete.length > 0) this.graphVersion++
  }

  clear(): void {
    this.nodes.clear()
    this.graphVersion++
    this.cachedReachable = null
  }

  get nodeCount(): number {
    return this.nodes.size
  }

  /**
   * Two-phase visibility determination:
   *  Phase 1 — BFS reachability (cached): flood-fill from camera section
   *            through ALL sections (air included), limited by distance only.
   *            Collects every registered (geometry-bearing) section that is
   *            reachable via 6-connected traversal.
   *  Phase 2 — Frustum filter (every frame): linear scan of reachable set,
   *            testing each node's actual bounds against the current frustum.
   */
  propagate(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    frustum: Frustum,
    maxDistanceSq: number,
    clusterEdgeChunks: number = 8,
  ): VisibilityBFSResult {
    const camChunkX = Math.floor(cameraX / 16)
    const camSectionY = Math.floor(cameraY / 16)
    const camChunkZ = Math.floor(cameraZ / 16)

    // Phase 1: get or compute reachable set (cached by camera section + graph version)
    let reachable: SectionNode[]
    let bfsVisited: number

    if (
      this.cachedReachable &&
      this.lastGraphVersion === this.graphVersion &&
      this.lastCamChunkX === camChunkX &&
      this.lastCamSectionY === camSectionY &&
      this.lastCamChunkZ === camChunkZ &&
      this.lastMaxDistSq === maxDistanceSq
    ) {
      reachable = this.cachedReachable
      bfsVisited = this.cachedBfsVisited
    } else {
      ;[reachable, bfsVisited] = this.computeReachable(
        cameraX,
        cameraY,
        cameraZ,
        camChunkX,
        camSectionY,
        camChunkZ,
        maxDistanceSq,
      )
      this.cachedReachable = reachable
      this.cachedBfsVisited = bfsVisited
      this.lastCamChunkX = camChunkX
      this.lastCamSectionY = camSectionY
      this.lastCamChunkZ = camChunkZ
      this.lastGraphVersion = this.graphVersion
      this.lastMaxDistSq = maxDistanceSq
    }

    // Phase 2: frustum filter (every frame, cheap linear scan)
    const visibleSections = new Set<string>()
    const visibleClusters = new Set<string>()

    for (const node of reachable) {
      if (
        frustum.intersectsBox(
          { x: node.boundsMin[0], y: node.boundsMin[1], z: node.boundsMin[2] },
          { x: node.boundsMax[0], y: node.boundsMax[1], z: node.boundsMax[2] },
        )
      ) {
        visibleSections.add(node.key)
        const clX = Math.floor(node.chunkX / clusterEdgeChunks)
        const clZ = Math.floor(node.chunkZ / clusterEdgeChunks)
        visibleClusters.add(`${clX},${clZ}`)
      }
    }

    return {
      visibleSections,
      visibleClusters,
      reachableCount: reachable.length,
      bfsVisitedCount: bfsVisited,
      totalCount: this.nodes.size,
    }
  }

  /**
   * BFS flood-fill from camera section through ALL sections (air + geometry).
   *
   * - Air sections (not in this.nodes) are fully transparent: BFS passes
   *   through them freely but they are NOT added to the reachable render set.
   * - Registered sections with geometry are collected into the reachable set.
   * - Distance² from section center to camera is the ONLY hard BFS cutoff.
   * - Passthrough masks gate exit/entry for registered sections; unregistered
   *   sections are treated as fully passable on all 6 faces.
   *
   * Uses SoA queues (separate X/Y/Z arrays) to avoid per-entry object
   * allocation and improve cache locality.
   */
  private computeReachable(
    cameraX: number,
    cameraY: number,
    cameraZ: number,
    camChunkX: number,
    camSectionY: number,
    camChunkZ: number,
    maxDistanceSq: number,
  ): [SectionNode[], number] {
    const visited = new Set<string>()
    const reachable: SectionNode[] = []

    // SoA BFS queue
    const qX: number[] = [camChunkX]
    const qY: number[] = [camSectionY]
    const qZ: number[] = [camChunkZ]
    visited.add(sectionKeyFromCoords(camChunkX, camSectionY, camChunkZ))

    let head = 0
    while (head < qX.length) {
      const cx = qX[head]
      const sy = qY[head]
      const cz = qZ[head]
      head++

      // Distance test on section center (hard cutoff for BFS)
      const wcx = cx * 16 + 8
      const wcy = sy * 16 + 8
      const wcz = cz * 16 + 8
      const dx = wcx - cameraX
      const dy = wcy - cameraY
      const dz = wcz - cameraZ
      if (dx * dx + dy * dy + dz * dz > maxDistanceSq) continue

      // Lookup: is this a registered section with geometry?
      const key = sectionKeyFromCoords(cx, sy, cz)
      const node = this.nodes.get(key)

      // Only geometry-bearing sections go into the reachable set
      if (node) reachable.push(node)

      // Propagate to 6 neighbors.
      // Air sections (node === undefined) propagate freely in all directions.
      // Registered sections are gated by their passthrough mask.
      for (let d = 0; d < 6; d++) {
        // Exit face check
        if (node && !(node.passthrough & (1 << d))) continue

        const [ndx, ndy, ndz] = DIR_OFFSETS[d]
        const nx = cx + ndx
        const ny = sy + ndy
        const nz = cz + ndz

        // Y range clamp
        if (ny < MIN_SECTION_Y || ny > MAX_SECTION_Y) continue

        const nKey = sectionKeyFromCoords(nx, ny, nz)
        if (visited.has(nKey)) continue

        // Entry face check (only for registered neighbors)
        const neighbor = this.nodes.get(nKey)
        if (neighbor && !(neighbor.passthrough & (1 << OPPOSITE_DIR[d]))) continue

        visited.add(nKey)
        qX.push(nx)
        qY.push(ny)
        qZ.push(nz)
      }
    }

    return [reachable, visited.size]
  }

  /** Force BFS recomputation on next propagate() call. */
  invalidateCache(): void {
    this.cachedReachable = null
  }
}
