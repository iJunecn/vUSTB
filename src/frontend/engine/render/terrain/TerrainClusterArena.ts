import {
  createTerrainResidentSlot,
  forEachTerrainDescriptorItemData,
  terrainClusterKeyToString,
  terrainSectionKeyToString,
  type TerrainItem,
  type TerrainPendingClusterUpload,
  type TerrainClusterCoord,
  type TerrainResidentCommitSource,
  type TerrainClusterResident,
  type TerrainResidentItemRecord,
  type TerrainResidentSectionRecord,
  type TerrainSectionKey,
  type TerrainSectionRemoval,
  type TerrainSectionUpdate,
} from './types'

interface PendingClusterState {
  updates: Map<string, TerrainSectionUpdate>
  removals: Map<string, TerrainSectionRemoval>
  itemRemovals: Map<TerrainItem, Map<string, TerrainSectionRemoval>>
}

export class TerrainClusterArena {
  private readonly clusters = new Map<string, TerrainClusterResident>()
  private readonly sections = new Map<string, TerrainResidentSectionRecord>()
  private readonly pending = new Map<string, PendingClusterState>()
  private nextResidentVersion = 1

  constructor(private readonly clusterEdgeChunks: number = 8) {}

  public stageSectionUpdate(update: TerrainSectionUpdate): void {
    const { key, descriptor, resolver } = update
    const sectionKey = terrainSectionKeyToString(key)
    const cluster = this.getClusterCoord(key.chunkX, key.chunkZ)
    const clusterKey = terrainClusterKeyToString(cluster)
    const resident = this.getOrCreateCluster(cluster)
    const existing = this.sections.get(sectionKey)
    const pending = this.getOrCreatePending(clusterKey)
    const items = new Map<TerrainItem, TerrainResidentItemRecord>()
    const nextItems = new Set<TerrainItem>()

    forEachTerrainDescriptorItemData(
      descriptor,
      resolver,
      (
        itemName,
        indexMode,
        layoutId,
        vertexStride,
        _vertexBytes,
        _indexBytes,
        vertexCount,
        indexCount,
      ) => {
        nextItems.add(itemName)
        const previous = existing?.items.get(itemName)
        items.set(itemName, {
          item: itemName,
          layoutId,
          indexMode: previous?.current?.indexMode ?? previous?.indexMode ?? indexMode,
          residentVersion: previous?.current?.residentVersion ?? previous?.residentVersion ?? 0,
          pendingResidentVersion: previous?.pendingResidentVersion ?? null,
          lastCommitSource: previous?.lastCommitSource ?? null,
          vertexStride,
          vertexCount,
          indexCount,
          artifactVersion: descriptor.buildVersion,
          current: previous?.current
            ? createTerrainResidentSlot({
                ...previous.current,
              })
            : null,
          pending: null,
        })
        resident.dirtyItems.add(itemName)
        this.deletePendingItemRemoval(pending, itemName, sectionKey)
      },
    )

    if (existing) {
      for (const previousItem of existing.items.keys()) {
        if (nextItems.has(previousItem)) {
          continue
        }

        resident.dirtyItems.add(previousItem)
        this.getOrCreatePendingItemRemovals(pending, previousItem).set(sectionKey, { key })
      }
    }

    this.sections.set(sectionKey, {
      key,
      cluster,
      buildVersion: descriptor.buildVersion,
      boundsMin: new Float32Array(descriptor.boundsMin),
      boundsMax: new Float32Array(descriptor.boundsMax),
      items,
    })
    resident.sectionKeys.add(sectionKey)

    pending.removals.delete(sectionKey)
    pending.updates.set(sectionKey, {
      key,
      descriptor,
      resolver,
      artifactVersion: descriptor.buildVersion,
    })
  }

  public stageSectionRemoval(key: TerrainSectionKey): void {
    const sectionKey = terrainSectionKeyToString(key)
    const existing = this.sections.get(sectionKey)
    const cluster = existing?.cluster ?? this.getClusterCoord(key.chunkX, key.chunkZ)
    const clusterKey = terrainClusterKeyToString(cluster)
    const resident = this.clusters.get(clusterKey)

    if (resident && existing) {
      for (const itemName of existing.items.keys()) {
        resident.dirtyItems.add(itemName)
      }
      resident.sectionKeys.delete(sectionKey)
      if (resident.sectionKeys.size === 0) {
        this.clusters.delete(clusterKey)
      }
    }

    this.sections.delete(sectionKey)

    const pending = this.getOrCreatePending(clusterKey)
    pending.updates.delete(sectionKey)
    pending.removals.set(sectionKey, { key })
    this.deletePendingItemRemovalsForSection(pending, sectionKey)
  }

  public removeChunk(chunkX: number, chunkZ: number): void {
    const removals: TerrainSectionKey[] = []

    for (const record of this.sections.values()) {
      if (record.key.chunkX === chunkX && record.key.chunkZ === chunkZ) {
        removals.push(record.key)
      }
    }

    for (const key of removals) {
      this.stageSectionRemoval(key)
    }
  }

  public drainPendingUploads(): TerrainPendingClusterUpload[] {
    const uploads: TerrainPendingClusterUpload[] = []

    for (const [clusterKey, state] of this.pending) {
      const resident = this.clusters.get(clusterKey)
      const [clusterX, clusterZ] = clusterKey.split(',').map(Number)
      uploads.push({
        cluster: { clusterX, clusterZ },
        clusterKey,
        dirtyItems: resident ? [...resident.dirtyItems] : this.collectDirtyItemsFromPending(state),
        sectionUpdates: [...state.updates.values()],
        sectionRemovals: [...state.removals.values()],
        itemRemovals: this.collectPendingItemRemovals(state),
        payloadArenaReleaseHandles: [],
      })
      resident?.dirtyItems.clear()
    }

    this.pending.clear()
    return uploads
  }

  public clear(): void {
    this.clusters.clear()
    this.sections.clear()
    this.pending.clear()
    this.nextResidentVersion = 1
  }

  public getSectionRecord(key: TerrainSectionKey) {
    return this.sections.get(terrainSectionKeyToString(key)) ?? null
  }

  public getClusterSections(clusterKey: string) {
    const resident = this.clusters.get(clusterKey)
    if (!resident) {
      return []
    }

    const sections: TerrainResidentSectionRecord[] = []
    for (const sectionKey of resident.sectionKeys) {
      const section = this.sections.get(sectionKey)
      if (section) {
        sections.push(section)
      }
    }
    return sections
  }

  public getClustersNeedingRebuildCount() {
    return 0
  }

  public markSectionItemUploaded(sectionKey: string, item: TerrainItem) {
    const record = this.sections.get(sectionKey)
    const itemRecord = record?.items.get(item)
    if (!itemRecord) {
      return
    }

    const pendingResidentVersion =
      itemRecord.pending?.residentVersion ??
      itemRecord.pendingResidentVersion ??
      this.allocateResidentVersion()

    itemRecord.pendingResidentVersion = pendingResidentVersion

    itemRecord.pending = createTerrainResidentSlot({
      layoutId: itemRecord.layoutId,
      indexMode: itemRecord.indexMode,
      residentVersion: pendingResidentVersion,
      vertexStride: itemRecord.vertexStride,
      vertexCount: itemRecord.vertexCount,
      indexCount: itemRecord.indexCount,
      artifactVersion: itemRecord.artifactVersion,
    })
  }

  public commitPendingResidentSegmentsForCluster(
    clusterKey: string,
    commitSource: TerrainResidentCommitSource,
  ) {
    const sections = this.getClusterSections(clusterKey)
    let committedCount = 0

    for (const section of sections) {
      for (const itemRecord of section.items.values()) {
        committedCount += this.commitPendingResidentSegments(itemRecord, commitSource)
      }
    }

    return committedCount
  }

  public getClusterCoord(chunkX: number, chunkZ: number): TerrainClusterCoord {
    return {
      clusterX: Math.floor(chunkX / this.clusterEdgeChunks),
      clusterZ: Math.floor(chunkZ / this.clusterEdgeChunks),
    }
  }

  public getClusterOriginChunk(cluster: TerrainClusterCoord) {
    return {
      chunkX: cluster.clusterX * this.clusterEdgeChunks,
      chunkZ: cluster.clusterZ * this.clusterEdgeChunks,
    }
  }

  private getOrCreateCluster(cluster: TerrainClusterCoord): TerrainClusterResident {
    const clusterKey = terrainClusterKeyToString(cluster)
    let resident = this.clusters.get(clusterKey)
    if (!resident) {
      resident = {
        key: cluster,
        clusterKey,
        sectionKeys: new Set(),
        dirtyItems: new Set(),
      }
      this.clusters.set(clusterKey, resident)
    }
    return resident
  }

  private getOrCreatePending(clusterKey: string): PendingClusterState {
    let pending = this.pending.get(clusterKey)
    if (!pending) {
      pending = {
        updates: new Map(),
        removals: new Map(),
        itemRemovals: new Map(),
      }
      this.pending.set(clusterKey, pending)
    }
    return pending
  }

  private collectDirtyItemsFromPending(state: PendingClusterState): TerrainItem[] {
    const dirtyItems = new Set<TerrainItem>()

    for (const update of state.updates.values()) {
      forEachTerrainDescriptorItemData(update.descriptor, update.resolver, itemName => {
        dirtyItems.add(itemName)
      })
    }

    for (const item of state.itemRemovals.keys()) {
      dirtyItems.add(item)
    }

    return [...dirtyItems]
  }

  private collectPendingItemRemovals(state: PendingClusterState) {
    const removals: Array<{ item: TerrainItem; removal: TerrainSectionRemoval }> = []

    for (const [item, entries] of state.itemRemovals) {
      for (const removal of entries.values()) {
        removals.push({ item, removal })
      }
    }

    return removals
  }

  private allocateResidentVersion() {
    return this.nextResidentVersion++
  }

  private commitPendingResidentSegments(
    itemRecord: TerrainResidentItemRecord,
    commitSource: TerrainResidentCommitSource,
  ) {
    const pending = itemRecord.pending
    if (!pending) {
      return 0
    }

    itemRecord.current = createTerrainResidentSlot(pending)
    itemRecord.pending = null
    itemRecord.residentVersion = itemRecord.current.residentVersion
    itemRecord.pendingResidentVersion = null
    itemRecord.lastCommitSource = commitSource
    return 1
  }

  private getOrCreatePendingItemRemovals(state: PendingClusterState, item: TerrainItem) {
    let removals = state.itemRemovals.get(item)
    if (!removals) {
      removals = new Map<string, TerrainSectionRemoval>()
      state.itemRemovals.set(item, removals)
    }
    return removals
  }

  private deletePendingItemRemoval(
    state: PendingClusterState,
    item: TerrainItem,
    sectionKey: string,
  ) {
    const removals = state.itemRemovals.get(item)
    if (!removals) {
      return
    }

    removals.delete(sectionKey)
    if (removals.size === 0) {
      state.itemRemovals.delete(item)
    }
  }

  private deletePendingItemRemovalsForSection(state: PendingClusterState, sectionKey: string) {
    for (const [item, removals] of state.itemRemovals) {
      removals.delete(sectionKey)
      if (removals.size === 0) {
        state.itemRemovals.delete(item)
      }
    }
  }
}
