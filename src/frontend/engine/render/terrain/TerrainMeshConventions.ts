/**
 * Terrain mesh index conventions shared with the runtime planner and GPU upload path.
 * Mirrors the authoritative Rust mesher encoding contract.
 */
export const QUAD_INDICES_CCW: readonly [number, number, number, number, number, number] = [
  0, 2, 1, 0, 3, 2,
]
