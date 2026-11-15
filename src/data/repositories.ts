import { GitRepository } from '../types/git';

export const CURATED_REPOSITORIES: GitRepository[] = [
  {
    id: 'prism-sync-engine',
    owner: 'prism-labs',
    name: 'realtime-crdt-engine',
    description:
      'Evolution of a collaborative document sync engine from naive REST polling to a conflict-free replicated data type (LWW-Element-Set CRDT) over multiplexed WebSockets.',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    commits: [
      {
        sha: '4a19b0c8e21f4390a1b2c3d4e5f60718293a4b5c',
        shortSha: '4a19b0c',
        parentSha: null,
        branch: 'main',
        tag: 'v0.1.0-alpha',
        title: 'Initial synchronous HTTP state store with full-document snapshots',
        message:
          'Bootstraps the document synchronization service using an in-memory Map and full JSON payload replacement on POST /sync. Simple to reason about for single-user sessions, but overwrites concurrent edits when two clients flush simultaneously.',
        author: 'Elena Vance',
        authorRole: 'Principal Systems Architect',
        timestamp: '2026-08-12 09:14:22',
        relativeTime: 'Commit 1 of 7',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/sync/DocumentStore.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `export interface DocumentSnapshot {
  docId: string;
  version: number;
  content: Record<string, string>;
  updatedAt: number;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public overwriteDocument(docId: string, content: Record<string, string>): DocumentSnapshot {
    const existing = this.documents.get(docId);
    const nextVersion = existing ? existing.version + 1 : 1;

    const snapshot: DocumentSnapshot = {
      docId,
      version: nextVersion,
      content: { ...content },
      updatedAt: Date.now(),
    };

    this.documents.set(docId, snapshot);
    return snapshot;
  }
}`,
          },
          {
            path: 'src/network/SyncTransport.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `import { DocumentStore, DocumentSnapshot } from '../sync/DocumentStore';

export class SyncTransport {
  constructor(private readonly store: DocumentStore) {}

  public async pollDocument(docId: string): Promise<DocumentSnapshot | null> {
    const snapshot = this.store.getDocument(docId);
    return snapshot ?? null;
  }

  public async pushFullSnapshot(
    docId: string,
    payload: Record<string, string>
  ): Promise<DocumentSnapshot> {
    // Naive last-arrival full document replacement
    return this.store.overwriteDocument(docId, payload);
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-01',
          title: 'Baseline Full-Document Snapshot Replacement over HTTP Polling',
          problemStatement:
            'We need a minimal working persistence layer to validate the collaborative editor UI before committing to a distributed consistency protocol.',
          decisionSummary:
            'Implemented a synchronous DocumentStore keyed by docId that replaces the entire key-value record map on every write.',
          tradeoffs: [
            'Zero protocol overhead and trivial serialization',
            'Lost-update anomaly whenever two clients push concurrently within the polling window',
            'O(N) network payload size on every keystroke flush',
          ],
          measurableOutcome: '220ms average round-trip sync latency · 18% lost updates under 5-user concurrency',
          modules: [
            {
              id: 'client-poller',
              name: 'HTTP Poll Client',
              layer: 'client',
              description: 'Polls /sync every 1000ms and sends full JSON snapshots',
              status: 'added',
              metrics: '1 req/s per tab',
            },
            {
              id: 'sync-transport',
              name: 'SyncTransport',
              layer: 'edge',
              description: 'Stateless request handler forwarding payloads to store',
              status: 'added',
              metrics: 'O(N) payload',
            },
            {
              id: 'doc-store',
              name: 'DocumentStore',
              layer: 'core',
              description: 'In-memory Map storing whole DocumentSnapshot objects',
              status: 'added',
              metrics: 'Full-doc lock',
            },
          ],
          edges: [
            { from: 'client-poller', to: 'sync-transport', protocol: 'HTTP POST / JSON', isNew: true },
            { from: 'sync-transport', to: 'doc-store', protocol: 'overwriteDocument()', isNew: true },
          ],
        },
      },
      {
        sha: '7c3e91f2a44d8011b2c9e8f12034a5b6c7d8e9f0',
        shortSha: '7c3e91f',
        parentSha: '4a19b0c8e21f4390a1b2c3d4e5f60718293a4b5c',
        branch: 'main',
        title: 'Enforce optimistic concurrency control via expectedVersion guards',
        message:
          'Prevents silent data loss by requiring clients to supply their base version when mutating a document. If the server version has advanced, throws a VersionConflictError so the client can rebase and retry.',
        author: 'Marcus Chen',
        authorRole: 'Staff Distributed Systems Engineer',
        timestamp: '2026-08-18 14:32:10',
        relativeTime: 'Commit 2 of 7',
        category: 'Bugfix',
        isArchitecturalMilestone: false,
        files: [
          {
            path: 'src/sync/DocumentStore.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export interface DocumentSnapshot {
  docId: string;
  version: number;
  content: Record<string, string>;
  updatedAt: number;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public overwriteDocument(docId: string, content: Record<string, string>): DocumentSnapshot {
    const existing = this.documents.get(docId);
    const nextVersion = existing ? existing.version + 1 : 1;

    const snapshot: DocumentSnapshot = {
      docId,
      version: nextVersion,
      content: { ...content },
      updatedAt: Date.now(),
    };

    this.documents.set(docId, snapshot);
    return snapshot;
  }
}`,
            content: `export interface DocumentSnapshot {
  docId: string;
  version: number;
  content: Record<string, string>;
  updatedAt: number;
}

export class VersionConflictError extends Error {
  constructor(
    public readonly docId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(\`Conflict on \${docId}: expected v\${expectedVersion}, found v\${actualVersion}\`);
  }
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public updateWithCAS(
    docId: string,
    expectedVersion: number,
    content: Record<string, string>
  ): DocumentSnapshot {
    const existing = this.documents.get(docId);
    const currentVersion = existing ? existing.version : 0;

    if (currentVersion !== expectedVersion) {
      throw new VersionConflictError(docId, expectedVersion, currentVersion);
    }

    const snapshot: DocumentSnapshot = {
      docId,
      version: currentVersion + 1,
      content: { ...content },
      updatedAt: Date.now(),
    };

    this.documents.set(docId, snapshot);
    return snapshot;
  }
}`,
          },
          {
            path: 'src/network/SyncTransport.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `import { DocumentStore, DocumentSnapshot } from '../sync/DocumentStore';

export class SyncTransport {
  constructor(private readonly store: DocumentStore) {}

  public async pollDocument(docId: string): Promise<DocumentSnapshot | null> {
    const snapshot = this.store.getDocument(docId);
    return snapshot ?? null;
  }

  public async pushFullSnapshot(
    docId: string,
    payload: Record<string, string>
  ): Promise<DocumentSnapshot> {
    // Naive last-arrival full document replacement
    return this.store.overwriteDocument(docId, payload);
  }
}`,
            content: `import { DocumentStore, DocumentSnapshot } from '../sync/DocumentStore';

export class SyncTransport {
  constructor(private readonly store: DocumentStore) {}

  public async pollDocument(docId: string): Promise<DocumentSnapshot | null> {
    const snapshot = this.store.getDocument(docId);
    return snapshot ?? null;
  }

  public async pushSnapshotCAS(
    docId: string,
    expectedVersion: number,
    payload: Record<string, string>
  ): Promise<DocumentSnapshot> {
    return this.store.updateWithCAS(docId, expectedVersion, payload);
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-02',
          title: 'Compare-And-Swap (CAS) Version Guards for Write Safety',
          problemStatement:
            'Concurrent editors were silently clobbering each other because overwriteDocument ignored the base version read by the client.',
          decisionSummary:
            'Replaced blind overwrite with updateWithCAS(docId, expectedVersion, content) and explicit VersionConflictError rejection.',
          tradeoffs: [
            'Eliminates silent data corruption immediately',
            'High retry storms when >4 users edit distinct fields in the same document simultaneously',
          ],
          measurableOutcome: '0% silent data loss · 34% CAS retry rate during peak collaborative editing',
          modules: [
            {
              id: 'client-poller',
              name: 'HTTP Poll Client',
              layer: 'client',
              description: 'Tracks local version and retries on HTTP 409 Conflict',
              status: 'modified',
              metrics: 'CAS retry loop',
            },
            {
              id: 'sync-transport',
              name: 'SyncTransport',
              layer: 'edge',
              description: 'Validates expectedVersion header against store',
              status: 'modified',
              metrics: '409 on mismatch',
            },
            {
              id: 'doc-store',
              name: 'DocumentStore',
              layer: 'core',
              description: 'Enforces monotonic version checks via updateWithCAS',
              status: 'modified',
              metrics: 'Strict CAS',
            },
          ],
          edges: [
            { from: 'client-poller', to: 'sync-transport', protocol: 'POST + If-Match vN', isNew: false },
            { from: 'sync-transport', to: 'doc-store', protocol: 'updateWithCAS()', isNew: true },
          ],
        },
      },
      {
        sha: '9f4b22d1c88e7304f1a2b3c4d5e6f7a8b9c0d1e2',
        shortSha: '9f4b22d',
        parentSha: '7c3e91f2a44d8011b2c9e8f12034a5b6c7d8e9f0',
        branch: 'main',
        tag: 'v0.3.0',
        title: 'Introduce Hybrid Logical Clock (HLC) & fine-grained field patches',
        message:
          'Replaces whole-document CAS locks with field-level delta operations ordered by a monotonic Hybrid Logical Clock (wall time + logical counter + nodeId). Clients modifying different keys no longer block each other.',
        author: 'Elena Vance',
        authorRole: 'Principal Systems Architect',
        timestamp: '2026-09-02 11:05:49',
        relativeTime: 'Commit 3 of 7',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/clock/HybridLogicalClock.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `export interface HLCTimestamp {
  wallTime: number;
  logical: number;
  nodeId: string;
}

export class HybridLogicalClock {
  private lastWallTime = 0;
  private logicalCounter = 0;

  constructor(public readonly nodeId: string) {}

  public now(physicalTime = Date.now()): HLCTimestamp {
    if (physicalTime > this.lastWallTime) {
      this.lastWallTime = physicalTime;
      this.logicalCounter = 0;
    } else {
      this.logicalCounter += 1;
    }
    return {
      wallTime: this.lastWallTime,
      logical: this.logicalCounter,
      nodeId: this.nodeId,
    };
  }

  public static compare(a: HLCTimestamp, b: HLCTimestamp): number {
    if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
    if (a.logical !== b.logical) return a.logical - b.logical;
    return a.nodeId.localeCompare(b.nodeId);
  }

  public static pack(ts: HLCTimestamp): string {
    return \`\${String(ts.wallTime).padStart(15, '0')}:\${String(ts.logical).padStart(5, '0')}:\${ts.nodeId}\`;
  }
}`,
          },
          {
            path: 'src/sync/DocumentStore.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export interface DocumentSnapshot {
  docId: string;
  version: number;
  content: Record<string, string>;
  updatedAt: number;
}

export class VersionConflictError extends Error {
  constructor(
    public readonly docId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(\`Conflict on \${docId}: expected v\${expectedVersion}, found v\${actualVersion}\`);
  }
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public updateWithCAS(
    docId: string,
    expectedVersion: number,
    content: Record<string, string>
  ): DocumentSnapshot {
    const existing = this.documents.get(docId);
    const currentVersion = existing ? existing.version : 0;

    if (currentVersion !== expectedVersion) {
      throw new VersionConflictError(docId, expectedVersion, currentVersion);
    }

    const snapshot: DocumentSnapshot = {
      docId,
      version: currentVersion + 1,
      content: { ...content },
      updatedAt: Date.now(),
    };

    this.documents.set(docId, snapshot);
    return snapshot;
  }
}`,
            content: `import { HLCTimestamp, HybridLogicalClock } from '../clock/HybridLogicalClock';

export interface FieldDelta {
  docId: string;
  fieldKey: string;
  value: string;
  timestamp: HLCTimestamp;
}

export interface DocumentSnapshot {
  docId: string;
  fields: Record<string, { value: string; timestamp: HLCTimestamp }>;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public applyDelta(delta: FieldDelta): boolean {
    let doc = this.documents.get(delta.docId);
    if (!doc) {
      doc = { docId: delta.docId, fields: {} };
      this.documents.set(delta.docId, doc);
    }

    const currentField = doc.fields[delta.fieldKey];
    if (!currentField || HybridLogicalClock.compare(delta.timestamp, currentField.timestamp) > 0) {
      doc.fields[delta.fieldKey] = {
        value: delta.value,
        timestamp: delta.timestamp,
      };
      return true;
    }

    return false;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-03',
          title: 'Causal Ordering with Hybrid Logical Clocks (HLC) & Per-Field Deltas',
          problemStatement:
            'Whole-document CAS caused false conflicts when User A edited the title while User B edited a paragraph body. Physical wall clocks alone cannot order concurrent offline events due to NTP skew.',
          decisionSummary:
            'Introduced HybridLogicalClock (wallTime + 16-bit logical counter + deterministic nodeId tie-breaker) and decomposed mutations into atomic FieldDelta packets.',
          tradeoffs: [
            'Eliminates 409 conflict retries via deterministic Last-Write-Wins (LWW) convergence',
            'Requires storing HLC metadata per key (approx. +28 bytes overhead per field)',
          ],
          measurableOutcome: '0% retry errors · Payload size reduced by 89% (from 42KB full doc to 180B delta)',
          modules: [
            {
              id: 'hlc-clock',
              name: 'HybridLogicalClock',
              layer: 'client',
              description: 'Generates monotonic causal timestamps tolerant to physical clock drift',
              status: 'added',
              metrics: 'Deterministic LWW',
            },
            {
              id: 'sync-transport',
              name: 'SyncTransport',
              layer: 'edge',
              description: 'Streams compact FieldDelta frames instead of full documents',
              status: 'modified',
              metrics: '180B avg frame',
            },
            {
              id: 'doc-store',
              name: 'DocumentStore',
              layer: 'core',
              description: 'Merges per-key HLC registers commute-freely in any arrival order',
              status: 'modified',
              metrics: 'Lock-free merge',
            },
          ],
          edges: [
            { from: 'hlc-clock', to: 'sync-transport', protocol: 'FieldDelta + HLC', isNew: true },
            { from: 'sync-transport', to: 'doc-store', protocol: 'applyDelta()', isNew: true },
          ],
        },
      },
      {
        sha: 'b28d40e9f11a6503c7d8e9f0a1b2c3d4e5f6a7b8',
        shortSha: 'b28d40e',
        parentSha: '9f4b22d1c88e7304f1a2b3c4d5e6f7a8b9c0d1e2',
        branch: 'main',
        title: 'Support tombstone deletions in LWW-Element-Set CRDT state',
        message:
          'Fixes the zombie field resurrection bug where deleting a key locally allowed stale out-of-order network packets to re-create the deleted key. Deletions now record a tombstone entry with an HLC timestamp.',
        author: 'Sora Takahashi',
        authorRole: 'Senior Core Engineer',
        timestamp: '2026-09-14 16:48:03',
        relativeTime: 'Commit 4 of 7',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/sync/DocumentStore.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `import { HLCTimestamp, HybridLogicalClock } from '../clock/HybridLogicalClock';

export interface FieldDelta {
  docId: string;
  fieldKey: string;
  value: string;
  timestamp: HLCTimestamp;
}

export interface DocumentSnapshot {
  docId: string;
  fields: Record<string, { value: string; timestamp: HLCTimestamp }>;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getDocument(docId: string): DocumentSnapshot | undefined {
    return this.documents.get(docId);
  }

  public applyDelta(delta: FieldDelta): boolean {
    let doc = this.documents.get(delta.docId);
    if (!doc) {
      doc = { docId: delta.docId, fields: {} };
      this.documents.set(delta.docId, doc);
    }

    const currentField = doc.fields[delta.fieldKey];
    if (!currentField || HybridLogicalClock.compare(delta.timestamp, currentField.timestamp) > 0) {
      doc.fields[delta.fieldKey] = {
        value: delta.value,
        timestamp: delta.timestamp,
      };
      return true;
    }

    return false;
  }
}`,
            content: `import { HLCTimestamp, HybridLogicalClock } from '../clock/HybridLogicalClock';

export interface FieldDelta {
  docId: string;
  fieldKey: string;
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface LWWRegister {
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface DocumentSnapshot {
  docId: string;
  registers: Record<string, LWWRegister>;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getMaterializedView(docId: string): Record<string, string> {
    const doc = this.documents.get(docId);
    if (!doc) return {};

    const active: Record<string, string> = {};
    for (const [key, reg] of Object.entries(doc.registers)) {
      if (!reg.deleted && reg.value !== null) {
        active[key] = reg.value;
      }
    }
    return active;
  }

  public applyDelta(delta: FieldDelta): boolean {
    let doc = this.documents.get(delta.docId);
    if (!doc) {
      doc = { docId: delta.docId, registers: {} };
      this.documents.set(delta.docId, doc);
    }

    const existing = doc.registers[delta.fieldKey];
    if (!existing || HybridLogicalClock.compare(delta.timestamp, existing.timestamp) > 0) {
      doc.registers[delta.fieldKey] = {
        value: delta.deleted ? null : delta.value,
        deleted: delta.deleted,
        timestamp: delta.timestamp,
      };
      return true;
    }

    return false;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-04',
          title: 'LWW-Element-Set CRDT with Explicit HLC Tombstones',
          problemStatement:
            'Removing a key via `delete doc.fields[k]` caused deleted properties to reappear whenever a delayed peer broadcasted an older state containing that key.',
          decisionSummary:
            'Converted field storage into an LWW-Element-Set CRDT where deletions write `deleted: true` tombstones guarded by HLC comparison.',
          tradeoffs: [
            'Guarantees strong eventual consistency (SEC) across arbitrary packet reordering and offline partitions',
            'Deleted keys remain in memory as tombstones until garbage-collected past the max offline TTL window',
          ],
          measurableOutcome: 'Passed 10,000-permutation Jepsen-style out-of-order fuzz tests with 100% state convergence',
          modules: [
            {
              id: 'hlc-clock',
              name: 'HybridLogicalClock',
              layer: 'client',
              description: 'Assigns causal timestamps to both mutations and tombstone deletes',
              status: 'existing',
              metrics: 'Causal order',
            },
            {
              id: 'doc-store',
              name: 'LWW CRDT Store',
              layer: 'core',
              description: 'Maintains LWWRegister map and projects live keys via getMaterializedView()',
              status: 'modified',
              metrics: 'SEC verified',
            },
          ],
          edges: [
            { from: 'hlc-clock', to: 'doc-store', protocol: 'LWWRegister merge', isNew: false },
          ],
        },
      },
      {
        sha: 'd41a88c0e52b9104a3b4c5d6e7f8091a2b3c4d5e',
        shortSha: 'd41a88c',
        parentSha: 'b28d40e9f11a6503c7d8e9f0a1b2c3d4e5f6a7b8',
        branch: 'main',
        tag: 'v0.5.0',
        title: 'Replace HTTP polling with multiplexed WebSocket pub/sub broker',
        message:
          'Retires the 1000ms HTTP polling loop in SyncTransport and introduces a persistent duplex WebSocket channel per room with backpressure-aware delta broadcasting to subscribed peers.',
        author: 'Marcus Chen',
        authorRole: 'Staff Distributed Systems Engineer',
        timestamp: '2026-09-27 10:19:44',
        relativeTime: 'Commit 5 of 7',
        category: 'Performance',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/network/SyncTransport.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `import { DocumentStore, DocumentSnapshot } from '../sync/DocumentStore';

export class SyncTransport {
  constructor(private readonly store: DocumentStore) {}

  public async pollDocument(docId: string): Promise<DocumentSnapshot | null> {
    const snapshot = this.store.getDocument(docId);
    return snapshot ?? null;
  }

  public async pushSnapshotCAS(
    docId: string,
    expectedVersion: number,
    payload: Record<string, string>
  ): Promise<DocumentSnapshot> {
    return this.store.updateWithCAS(docId, expectedVersion, payload);
  }
}`,
            content: `import { DocumentStore, FieldDelta } from '../sync/DocumentStore';

export interface PeerSocket {
  peerId: string;
  send(frame: string): void;
}

export class SyncTransport {
  private rooms = new Map<string, Set<PeerSocket>>();

  constructor(private readonly store: DocumentStore) {}

  public subscribePeer(docId: string, peer: PeerSocket): void {
    let subscribers = this.rooms.get(docId);
    if (!subscribers) {
      subscribers = new Set();
      this.rooms.set(docId, subscribers);
    }
    subscribers.add(peer);
  }

  public unsubscribePeer(docId: string, peer: PeerSocket): void {
    this.rooms.get(docId)?.delete(peer);
  }

  public handleIncomingDelta(senderId: string, delta: FieldDelta): number {
    const applied = this.store.applyDelta(delta);
    if (!applied) return 0;

    const subscribers = this.rooms.get(delta.docId);
    if (!subscribers) return 0;

    const serialized = JSON.stringify(delta);
    let fanoutCount = 0;

    for (const peer of subscribers) {
      if (peer.peerId !== senderId) {
        peer.send(serialized);
        fanoutCount += 1;
      }
    }

    return fanoutCount;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-05',
          title: 'Room-Partitioned WebSocket Multiplexing & Zero-Copy Fanout',
          problemStatement:
            'HTTP polling generated 94% empty responses and imposed a 500ms median visibility delay between peer keystrokes.',
          decisionSummary:
            'Replaced polling endpoints with room-scoped WebSocket subscriber sets that only broadcast deltas that actually win the CRDT HLC check.',
          tradeoffs: [
            'Sub-20ms peer-to-peer keystroke propagation and 91% reduction in idle ingress traffic',
            'Stateful connection affinity requires sticky routing or pub/sub bridge across edge nodes',
          ],
          measurableOutcome: 'p95 propagation latency dropped from 640ms to 14ms · Idle CPU down 78%',
          modules: [
            {
              id: 'ws-client',
              name: 'Duplex WS Client',
              layer: 'client',
              description: 'Maintains persistent socket with automatic reconnection',
              status: 'added',
              metrics: '14ms p95',
            },
            {
              id: 'sync-transport',
              name: 'Room Pub/Sub Broker',
              layer: 'edge',
              description: 'Broadcasts winning CRDT deltas only to active room subscribers',
              status: 'modified',
              metrics: 'Zero idle polls',
            },
            {
              id: 'doc-store',
              name: 'LWW CRDT Store',
              layer: 'core',
              description: 'Filters stale deltas before network fanout',
              status: 'existing',
              metrics: 'Idempotent',
            },
          ],
          edges: [
            { from: 'ws-client', to: 'sync-transport', protocol: 'WSS Frame Stream', isNew: true },
            { from: 'sync-transport', to: 'doc-store', protocol: 'applyDelta()', isNew: false },
          ],
        },
      },
      {
        sha: 'e83f19a7b20c5412d9e8f7a6b5c4d3e2f1a0b9c8',
        shortSha: 'e83f19a',
        parentSha: 'd41a88c0e52b9104a3b4c5d6e7f8091a2b3c4d5e',
        branch: 'main',
        title: 'Batch micro-deltas over 16ms frame window to prevent socket head-of-line blocking',
        message:
          'Coalesces rapid pointer/typing bursts within a 16ms requestAnimationFrame cadence before flushing over the WebSocket. If a client mutates the same field 10 times in 12ms, only the latest HLC register wins in the outbound batch.',
        author: 'Sora Takahashi',
        authorRole: 'Senior Core Engineer',
        timestamp: '2026-10-08 15:11:27',
        relativeTime: 'Commit 6 of 7',
        category: 'Performance',
        isArchitecturalMilestone: false,
        files: [
          {
            path: 'src/network/DeltaBatcher.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `import { FieldDelta } from '../sync/DocumentStore';
import { HybridLogicalClock } from '../clock/HybridLogicalClock';

export class DeltaBatcher {
  private pendingByField = new Map<string, FieldDelta>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly windowMs: number = 16,
    private readonly onFlush: (batch: FieldDelta[]) => void
  ) {}

  public enqueue(delta: FieldDelta): void {
    const compositeKey = \`\${delta.docId}::\${delta.fieldKey}\`;
    const existing = this.pendingByField.get(compositeKey);

    if (!existing || HybridLogicalClock.compare(delta.timestamp, existing.timestamp) > 0) {
      this.pendingByField.set(compositeKey, delta);
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushNow(), this.windowMs);
    }
  }

  public flushNow(): FieldDelta[] {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = Array.from(this.pendingByField.values());
    this.pendingByField.clear();

    if (batch.length > 0) {
      this.onFlush(batch);
    }
    return batch;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-06',
          title: 'Client-Side 16ms Frame Coalescing via Idempotent HLC Compaction',
          problemStatement:
            'High-frequency slider drags and cursor selection updates emitted 240+ individual WebSocket frames per second, saturating mobile TCP send buffers.',
          decisionSummary:
            'Created DeltaBatcher which folds intermediate updates to the same `(docId, fieldKey)` within a 16ms frame window using the same HLC comparator as the server.',
          tradeoffs: [
            'Cuts outbound frame rate by 74% during rapid drag gestures without losing causal ordering',
            'Adds up to 16ms (1 display frame) of intentional buffering latency',
          ],
          measurableOutcome: 'Peak WebSocket frame rate capped at 60 fps · 4.2x higher concurrent room capacity',
          modules: [
            {
              id: 'delta-batcher',
              name: 'DeltaBatcher (16ms)',
              layer: 'client',
              description: 'Compacts burst mutations per key before socket serialization',
              status: 'added',
              metrics: '60Hz max flush',
            },
            {
              id: 'sync-transport',
              name: 'Room Pub/Sub Broker',
              layer: 'edge',
              description: 'Processes compacted batch frames atomically',
              status: 'existing',
              metrics: '74% fewer syscalls',
            },
          ],
          edges: [
            { from: 'delta-batcher', to: 'sync-transport', protocol: 'Coalesced Frame[]', isNew: true },
          ],
        },
      },
      {
        sha: 'f09c77e3a12b4809c6d5e4f3a2b1c0d9e8f7a6b5',
        shortSha: 'f09c77e',
        parentSha: 'e83f19a7b20c5412d9e8f7a6b5c4d3e2f1a0b9c8',
        branch: 'main',
        tag: 'v1.0.0',
        title: 'Add IndexedDB write-ahead log (WAL) & Merkle state vector anti-entropy sync',
        message:
          'Completes the v1.0 offline-first architecture. Unacknowledged client batches persist to a local WAL and reconcile upon reconnect by exchanging compact per-document HLC high-water vectors instead of re-downloading the entire document.',
        author: 'Elena Vance',
        authorRole: 'Principal Systems Architect',
        timestamp: '2026-10-21 18:40:12',
        relativeTime: 'Commit 7 of 7',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/sync/DocumentStore.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `import { HLCTimestamp, HybridLogicalClock } from '../clock/HybridLogicalClock';

export interface FieldDelta {
  docId: string;
  fieldKey: string;
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface LWWRegister {
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface DocumentSnapshot {
  docId: string;
  registers: Record<string, LWWRegister>;
}

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();

  public getMaterializedView(docId: string): Record<string, string> {
    const doc = this.documents.get(docId);
    if (!doc) return {};

    const active: Record<string, string> = {};
    for (const [key, reg] of Object.entries(doc.registers)) {
      if (!reg.deleted && reg.value !== null) {
        active[key] = reg.value;
      }
    }
    return active;
  }

  public applyDelta(delta: FieldDelta): boolean {
    let doc = this.documents.get(delta.docId);
    if (!doc) {
      doc = { docId: delta.docId, registers: {} };
      this.documents.set(delta.docId, doc);
    }

    const existing = doc.registers[delta.fieldKey];
    if (!existing || HybridLogicalClock.compare(delta.timestamp, existing.timestamp) > 0) {
      doc.registers[delta.fieldKey] = {
        value: delta.deleted ? null : delta.value,
        deleted: delta.deleted,
        timestamp: delta.timestamp,
      };
      return true;
    }

    return false;
  }
}`,
            content: `import { HLCTimestamp, HybridLogicalClock } from '../clock/HybridLogicalClock';

export interface FieldDelta {
  docId: string;
  fieldKey: string;
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface LWWRegister {
  value: string | null;
  deleted: boolean;
  timestamp: HLCTimestamp;
}

export interface DocumentSnapshot {
  docId: string;
  registers: Record<string, LWWRegister>;
}

export type StateVector = Record<string, string>; // nodeId -> packed max HLCTimestamp

export class DocumentStore {
  private documents = new Map<string, DocumentSnapshot>();
  private stateVectors = new Map<string, StateVector>();

  public getMaterializedView(docId: string): Record<string, string> {
    const doc = this.documents.get(docId);
    if (!doc) return {};

    const active: Record<string, string> = {};
    for (const [key, reg] of Object.entries(doc.registers)) {
      if (!reg.deleted && reg.value !== null) {
        active[key] = reg.value;
      }
    }
    return active;
  }

  public computeMissingDeltas(docId: string, peerVector: StateVector): FieldDelta[] {
    const doc = this.documents.get(docId);
    if (!doc) return [];

    const missing: FieldDelta[] = [];
    for (const [fieldKey, reg] of Object.entries(doc.registers)) {
      const packedRegisterTs = HybridLogicalClock.pack(reg.timestamp);
      const peerHighWater = peerVector[reg.timestamp.nodeId];
      if (!peerHighWater || packedRegisterTs > peerHighWater) {
        missing.push({
          docId,
          fieldKey,
          value: reg.value,
          deleted: reg.deleted,
          timestamp: reg.timestamp,
        });
      }
    }
    return missing;
  }

  public applyDelta(delta: FieldDelta): boolean {
    let doc = this.documents.get(delta.docId);
    if (!doc) {
      doc = { docId: delta.docId, registers: {} };
      this.documents.set(delta.docId, doc);
    }

    const existing = doc.registers[delta.fieldKey];
    if (!existing || HybridLogicalClock.compare(delta.timestamp, existing.timestamp) > 0) {
      doc.registers[delta.fieldKey] = {
        value: delta.deleted ? null : delta.value,
        deleted: delta.deleted,
        timestamp: delta.timestamp,
      };
      this.advanceStateVector(delta.docId, delta.timestamp);
      return true;
    }

    return false;
  }

  private advanceStateVector(docId: string, ts: HLCTimestamp): void {
    const vec = this.stateVectors.get(docId) ?? {};
    const packed = HybridLogicalClock.pack(ts);
    if (!vec[ts.nodeId] || packed > vec[ts.nodeId]) {
      vec[ts.nodeId] = packed;
      this.stateVectors.set(docId, vec);
    }
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-07',
          title: 'State Vector Anti-Entropy Reconnection Protocol',
          problemStatement:
            'Clients reconnecting after a 30-second subway tunnel disconnection were re-fetching the entire document state even when only 2 fields had changed.',
          decisionSummary:
            'Added per-node HLC StateVector tracking and `computeMissingDeltas(docId, peerVector)` so reconnecting peers exchange only deltas newer than their high-water mark.',
          tradeoffs: [
            'Reconnect catch-up payload scales with actual missed mutations O(k) rather than document size O(N)',
            'Requires tracking a per-node high-water map on each active document',
          ],
          measurableOutcome: '98.4% reduction in reconnect bandwidth · Full offline-to-online convergence in <25ms',
          modules: [
            {
              id: 'delta-batcher',
              name: 'Offline WAL + Batcher',
              layer: 'client',
              description: 'Persists unacknowledged deltas and sends local StateVector on reconnect',
              status: 'modified',
              metrics: 'Zero offline loss',
            },
            {
              id: 'sync-transport',
              name: 'Room Pub/Sub Broker',
              layer: 'edge',
              description: 'Negotiates StateVector handshake upon WebSocket upgrade',
              status: 'existing',
              metrics: 'O(k) catch-up',
            },
            {
              id: 'doc-store',
              name: 'LWW CRDT + StateVector',
              layer: 'core',
              description: 'Computes exact missing delta slice via high-water vector diff',
              status: 'modified',
              metrics: '<25ms resync',
            },
            {
              id: 'wal-storage',
              name: 'IndexedDB Snapshot Store',
              layer: 'storage',
              description: 'Durable client-side CRDT log for instant cold boot',
              status: 'added',
              metrics: 'Local-first',
            },
          ],
          edges: [
            { from: 'delta-batcher', to: 'wal-storage', protocol: 'IndexedDB WAL', isNew: true },
            { from: 'delta-batcher', to: 'sync-transport', protocol: 'SYN + StateVector', isNew: true },
            { from: 'sync-transport', to: 'doc-store', protocol: 'computeMissingDeltas()', isNew: true },
          ],
        },
      },
    ],
  },
  {
    id: 'aether-query-planner',
    owner: 'aether-db',
    name: 'vectorized-query-engine',
    description:
      'Architectural evolution of an embedded analytical SQL engine from a row-at-a-time Volcano iterator to columnar Arrow-style SIMD batch execution with late materialization.',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    commits: [
      {
        sha: '101a202b303c404d505e606f707a808b909c000d',
        shortSha: '101a202',
        parentSha: null,
        branch: 'main',
        tag: 'v0.1.0',
        title: 'Implement classic Volcano row-at-a-time pull iterator pipeline',
        message:
          'Establishes the baseline Scan -> Filter -> Aggregate operator tree using the classic Volcano `next(): Row | null` tuple-at-a-time model.',
        author: 'Dr. Aris Thorne',
        authorRole: 'Chief Database Architect',
        timestamp: '2026-07-04 10:12:00',
        relativeTime: 'Commit 1 of 4',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/exec/Operator.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `export type TupleRow = Record<string, number | string>;

export interface VolcanoOperator {
  open(): void;
  next(): TupleRow | null;
  close(): void;
}

export class FilterOperator implements VolcanoOperator {
  constructor(
    private readonly child: VolcanoOperator,
    private readonly predicate: (row: TupleRow) => boolean
  ) {}

  public open(): void {
    this.child.open();
  }

  public next(): TupleRow | null {
    while (true) {
      const row = this.child.next();
      if (row === null) return null;
      if (this.predicate(row)) {
        return row;
      }
    }
  }

  public close(): void {
    this.child.close();
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-01',
          title: 'Volcano Tuple-at-a-Time Pull Iterator Baseline',
          problemStatement:
            'Need a composable relational algebra execution interface where physical operators can be arbitrarily nested.',
          decisionSummary:
            'Implemented the classic `open() / next() / close()` Volcano iterator contract returning one boxed TupleRow object per call.',
          tradeoffs: [
            'Clean operator composability with minimal memory footprint',
            'Millions of virtual function dispatches and heap allocations per query scan',
          ],
          measurableOutcome: '14.2M rows/sec scan throughput · 68% CPU time spent in virtual call overhead',
          modules: [
            {
              id: 'sql-parser',
              name: 'Logical Planner',
              layer: 'client',
              description: 'Lowers AST into nested VolcanoOperator tree',
              status: 'added',
              metrics: 'AST -> Tree',
            },
            {
              id: 'volcano-exec',
              name: 'Volcano Iterator',
              layer: 'core',
              description: 'Pulls 1 TupleRow per next() virtual invocation',
              status: 'added',
              metrics: '14.2M rows/s',
            },
            {
              id: 'row-heap',
              name: 'Row Heap Table',
              layer: 'storage',
              description: 'Array of boxed JS/TS row dictionaries',
              status: 'added',
              metrics: 'Row-oriented',
            },
          ],
          edges: [
            { from: 'sql-parser', to: 'volcano-exec', protocol: 'next(): TupleRow', isNew: true },
            { from: 'volcano-exec', to: 'row-heap', protocol: 'Sequential row read', isNew: true },
          ],
        },
      },
      {
        sha: '202b303c404d505e606f707a808b909c000d111e',
        shortSha: '202b303',
        parentSha: '101a202b303c404d505e606f707a808b909c000d',
        branch: 'main',
        tag: 'v0.4.0',
        title: 'Migrate execution engine to columnar Float64Array / Int32Array vector batches',
        message:
          'Replaces row-by-row object boxing with 1024-row columnar VectorBatch slices backed by contiguous TypedArrays that fit inside L1 CPU cache.',
        author: 'Dr. Aris Thorne',
        authorRole: 'Chief Database Architect',
        timestamp: '2026-07-29 15:44:18',
        relativeTime: 'Commit 2 of 4',
        category: 'Performance',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/exec/Operator.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export type TupleRow = Record<string, number | string>;

export interface VolcanoOperator {
  open(): void;
  next(): TupleRow | null;
  close(): void;
}

export class FilterOperator implements VolcanoOperator {
  constructor(
    private readonly child: VolcanoOperator,
    private readonly predicate: (row: TupleRow) => boolean
  ) {}

  public open(): void {
    this.child.open();
  }

  public next(): TupleRow | null {
    while (true) {
      const row = this.child.next();
      if (row === null) return null;
      if (this.predicate(row)) {
        return row;
      }
    }
  }

  public close(): void {
    this.child.close();
  }
}`,
            content: `export const VECTOR_SIZE = 1024;

export interface VectorBatch {
  rowCount: number;
  columns: Record<string, Float64Array | Int32Array>;
}

export interface VectorizedOperator {
  open(): void;
  nextBatch(): VectorBatch | null;
  close(): void;
}

export class VectorFilterOperator implements VectorizedOperator {
  constructor(
    private readonly child: VectorizedOperator,
    private readonly columnName: string,
    private readonly threshold: number
  ) {}

  public open(): void {
    this.child.open();
  }

  public nextBatch(): VectorBatch | null {
    const batch = this.child.nextBatch();
    if (!batch || batch.rowCount === 0) return null;

    const col = batch.columns[this.columnName];
    const outCol = new Float64Array(VECTOR_SIZE);
    let writeIdx = 0;

    for (let i = 0; i < batch.rowCount; i++) {
      if (col[i] > this.threshold) {
        outCol[writeIdx++] = col[i];
      }
    }

    return {
      rowCount: writeIdx,
      columns: { [this.columnName]: outCol.subarray(0, writeIdx) },
    };
  }

  public close(): void {
    this.child.close();
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-02',
          title: 'Columnar 1024-Element Vectorized Execution Batches',
          problemStatement:
            'Row-at-a-time iteration bottlenecked on pointer chasing and per-tuple virtual dispatch across 10M+ row analytical scans.',
          decisionSummary:
            'Redesigned operators around `VectorBatch` (1024 contiguous TypedArray elements per column) to amortize virtual calls by 1024x and unlock CPU prefetching.',
          tradeoffs: [
            '8.4x throughput increase and zero per-row heap allocations',
            'Materializing filtered subarrays still copies surviving column values eagerly',
          ],
          measurableOutcome: 'Throughput jumped from 14.2M to 119.5M rows/sec · GC pause time reduced to 0ms',
          modules: [
            {
              id: 'sql-parser',
              name: 'Vector Planner',
              layer: 'client',
              description: 'Schedules 1024-row L1-cache-resident column batches',
              status: 'modified',
              metrics: 'Batch=1024',
            },
            {
              id: 'volcano-exec',
              name: 'VectorizedOperator',
              layer: 'core',
              description: 'Processes tight TypedArray loops with 1/1024th call overhead',
              status: 'modified',
              metrics: '119.5M rows/s',
            },
            {
              id: 'col-store',
              name: 'Columnar TypedArrays',
              layer: 'storage',
              description: 'Contiguous Float64Array / Int32Array column buffers',
              status: 'added',
              metrics: 'Zero boxing',
            },
          ],
          edges: [
            { from: 'sql-parser', to: 'volcano-exec', protocol: 'nextBatch()', isNew: true },
            { from: 'volcano-exec', to: 'col-store', protocol: 'TypedArray slice', isNew: true },
          ],
        },
      },
      {
        sha: '303c404d505e606f707a808b909c000d111e222f',
        shortSha: '303c404',
        parentSha: '202b303c404d505e606f707a808b909c000d111e',
        branch: 'main',
        tag: 'v0.8.0',
        title: 'Add SelectionVector indirection for zero-copy late materialization',
        message:
          'Avoids copying surviving column elements during filtering. Filter operators now emit a compact Uint16Array SelectionVector of passing row indices so downstream projections only touch surviving rows.',
        author: 'Linnea Lindqvist',
        authorRole: 'Principal Performance Engineer',
        timestamp: '2026-08-19 13:20:05',
        relativeTime: 'Commit 3 of 4',
        category: 'Performance',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/exec/Operator.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export const VECTOR_SIZE = 1024;

export interface VectorBatch {
  rowCount: number;
  columns: Record<string, Float64Array | Int32Array>;
}

export interface VectorizedOperator {
  open(): void;
  nextBatch(): VectorBatch | null;
  close(): void;
}

export class VectorFilterOperator implements VectorizedOperator {
  constructor(
    private readonly child: VectorizedOperator,
    private readonly columnName: string,
    private readonly threshold: number
  ) {}

  public open(): void {
    this.child.open();
  }

  public nextBatch(): VectorBatch | null {
    const batch = this.child.nextBatch();
    if (!batch || batch.rowCount === 0) return null;

    const col = batch.columns[this.columnName];
    const outCol = new Float64Array(VECTOR_SIZE);
    let writeIdx = 0;

    for (let i = 0; i < batch.rowCount; i++) {
      if (col[i] > this.threshold) {
        outCol[writeIdx++] = col[i];
      }
    }

    return {
      rowCount: writeIdx,
      columns: { [this.columnName]: outCol.subarray(0, writeIdx) },
    };
  }

  public close(): void {
    this.child.close();
  }
}`,
            content: `export const VECTOR_SIZE = 1024;

export interface VectorBatch {
  rowCount: number;
  selectionVector: Uint16Array | null;
  columns: Record<string, Float64Array | Int32Array>;
}

export interface VectorizedOperator {
  open(): void;
  nextBatch(): VectorBatch | null;
  close(): void;
}

export class VectorFilterOperator implements VectorizedOperator {
  private readonly selBuffer = new Uint16Array(VECTOR_SIZE);

  constructor(
    private readonly child: VectorizedOperator,
    private readonly columnName: string,
    private readonly threshold: number
  ) {}

  public open(): void {
    this.child.open();
  }

  public nextBatch(): VectorBatch | null {
    const batch = this.child.nextBatch();
    if (!batch || batch.rowCount === 0) return null;

    const col = batch.columns[this.columnName];
    const inputSel = batch.selectionVector;
    let matchCount = 0;

    if (inputSel === null) {
      for (let i = 0; i < batch.rowCount; i++) {
        if (col[i] > this.threshold) {
          this.selBuffer[matchCount++] = i;
        }
      }
    } else {
      for (let i = 0; i < batch.rowCount; i++) {
        const physicalIdx = inputSel[i];
        if (col[physicalIdx] > this.threshold) {
          this.selBuffer[matchCount++] = physicalIdx;
        }
      }
    }

    return {
      rowCount: matchCount,
      selectionVector: this.selBuffer.subarray(0, matchCount),
      columns: batch.columns, // Zero-copy column buffer passthrough
    };
  }

  public close(): void {
    this.child.close();
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-03',
          title: 'Zero-Copy Filtering via Pre-Allocated Uint16 Selection Vectors',
          problemStatement:
            'Multi-column queries were copying 8+ wide columns after every WHERE clause predicate even when only 5% of rows survived.',
          decisionSummary:
            'Added a pre-allocated `Uint16Array(1024)` SelectionVector to VectorBatch so filters pass the underlying column buffers untouched and only record surviving row offsets.',
          tradeoffs: [
            'Eliminates all intermediate memory allocations and column data copies during filtering',
            'Downstream operators must branch on `selectionVector !== null` for indexed vs dense loops',
          ],
          measurableOutcome: '268M rows/sec on multi-predicate TPC-H Q6 · 0 bytes allocated per batch',
          modules: [
            {
              id: 'sel-vector',
              name: 'SelectionVector (Uint16)',
              layer: 'core',
              description: 'Tracks active row indices [0..1023] without copying column arrays',
              status: 'added',
              metrics: 'Zero-copy filter',
            },
            {
              id: 'volcano-exec',
              name: 'Late Materializer',
              layer: 'core',
              description: 'Defers reading non-predicate columns until final projection',
              status: 'modified',
              metrics: '268M rows/s',
            },
            {
              id: 'col-store',
              name: 'Columnar TypedArrays',
              layer: 'storage',
              description: 'Read-only memory-mapped column pages',
              status: 'existing',
              metrics: 'Immutable pages',
            },
          ],
          edges: [
            { from: 'sel-vector', to: 'volcano-exec', protocol: 'Uint16Array offsets', isNew: true },
            { from: 'volcano-exec', to: 'col-store', protocol: 'Indexed gather', isNew: true },
          ],
        },
      },
      {
        sha: '404d505e606f707a808b909c000d111e222f333a',
        shortSha: '404d505',
        parentSha: '303c404d505e606f707a808b909c000d111e222f',
        branch: 'main',
        tag: 'v1.0.0',
        title: 'Skip entire 64K-row storage row-groups using Min/Max ZoneMap pruning',
        message:
          'Stores min/max synopsis statistics per 65,536-row segment header. When a filter threshold falls completely outside `[segment.min, segment.max]`, the scanner skips reading the entire column segment.',
        author: 'Linnea Lindqvist',
        authorRole: 'Principal Performance Engineer',
        timestamp: '2026-09-10 17:02:51',
        relativeTime: 'Commit 4 of 4',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/storage/ZoneMapScanner.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `export interface ColumnZoneMap {
  segmentId: number;
  rowCount: number;
  min: number;
  max: number;
  data: Float64Array;
}

export class ZoneMapScanner {
  public prunedSegments = 0;
  public scannedSegments = 0;

  constructor(private readonly segments: ColumnZoneMap[]) {}

  public scanGreaterThan(threshold: number): Float64Array[] {
    const qualifyingPages: Float64Array[] = [];

    for (const seg of this.segments) {
      // ZoneMap min/max pruning: skip entire 64K segment if max <= threshold
      if (seg.max <= threshold) {
        this.prunedSegments += 1;
        continue;
      }
      this.scannedSegments += 1;
      qualifyingPages.push(seg.data);
    }

    return qualifyingPages;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-04',
          title: 'Storage-Layer ZoneMap Synopsis Pruning (Min/Max Pushdown)',
          problemStatement:
            'Even at 268M rows/sec, scanning cold time-series segments that cannot possibly match the query predicate wastes memory bandwidth.',
          decisionSummary:
            'Pushed predicate bounds down into `ZoneMapScanner` to evaluate `[min, max]` segment headers before touching column buffers.',
          tradeoffs: [
            'Skips 90%+ of cold storage blocks on time-clustered or sorted columns in O(1) time',
            'Requires maintaining 16-byte min/max headers on segment compaction',
          ],
          measurableOutcome: 'Effective scan speed reached 1.4B rows/sec on selective range queries (92% blocks pruned)',
          modules: [
            {
              id: 'zonemap-index',
              name: 'ZoneMap Pruning Engine',
              layer: 'storage',
              description: 'Evaluates predicate against [min, max] per 64K-row segment header',
              status: 'added',
              metrics: '92% I/O skipped',
            },
            {
              id: 'sel-vector',
              name: 'SelectionVector (Uint16)',
              layer: 'core',
              description: 'Filters only unpruned candidate segments',
              status: 'existing',
              metrics: 'Zero-copy',
            },
            {
              id: 'col-store',
              name: '64K Row-Group Segments',
              layer: 'storage',
              description: 'Self-describing columnar blocks with min/max synopsis',
              status: 'modified',
              metrics: '1.4B eff. rows/s',
            },
          ],
          edges: [
            { from: 'zonemap-index', to: 'col-store', protocol: 'Header check [min,max]', isNew: true },
            { from: 'zonemap-index', to: 'sel-vector', protocol: 'Surviving pages only', isNew: true },
          ],
        },
      },
    ],
  },
  {
    id: 'envoy-rate-limiter',
    owner: 'cloud-edge',
    name: 'distributed-token-bucket',
    description:
      'Evolution of an API gateway rate limiter from centralized Redis mutex locks to hybrid local token leases with gossip-synchronized quota rebalance.',
    defaultBranch: 'main',
    primaryLanguage: 'TypeScript',
    commits: [
      {
        sha: 'aa11bb22cc33dd44ee55ff6677889900aabbccdd',
        shortSha: 'aa11bb2',
        parentSha: null,
        branch: 'main',
        tag: 'v0.1.0',
        title: 'Centralized Redis GET/SET rate counter per incoming API request',
        message:
          'Initial rate limiter implementation that queries a central Redis key on every HTTP request. Suffers from race conditions between GET and INCR and adds a synchronous network hop to every API call.',
        author: 'Devon Brooks',
        authorRole: 'Staff Edge Infrastructure Engineer',
        timestamp: '2026-08-01 08:30:00',
        relativeTime: 'Commit 1 of 3',
        category: 'Architecture',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/ratelimit/GatewayLimiter.ts',
            language: 'typescript',
            status: 'added',
            previousContent: '',
            content: `export interface RedisClient {
  get(key: string): Promise<number | null>;
  set(key: string, count: number, ttlSeconds: number): Promise<void>;
}

export class GatewayLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly limitPerMinute: number
  ) {}

  public async allowRequest(tenantId: string): Promise<boolean> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const key = \`rl:\${tenantId}:\${minuteBucket}\`;

    const current = (await this.redis.get(key)) ?? 0;
    if (current >= this.limitPerMinute) {
      return false;
    }

    // Non-atomic read-modify-write + synchronous network RTT on hot path
    await this.redis.set(key, current + 1, 60);
    return true;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-01',
          title: 'Synchronous Fixed-Window Counter in Centralized Redis',
          problemStatement:
            'Protect multi-tenant upstream APIs from abusive traffic spikes across 12 stateless edge proxy pods.',
          decisionSummary:
            'Implemented a fixed 60-second window counter in Redis checked before forwarding each request.',
          tradeoffs: [
            'Simple global visibility across all gateway pods',
            '2 serial Redis RTTs per request (+3.8ms p99 latency) and boundary burst vulnerability at minute rollovers',
          ],
          measurableOutcome: '+3.8ms gateway latency overhead · Redis CPU saturated at 45k req/sec',
          modules: [
            {
              id: 'edge-proxy',
              name: 'Edge Gateway Pod',
              layer: 'edge',
              description: 'Blocks request thread awaiting 2 sequential Redis calls',
              status: 'added',
              metrics: '+3.8ms RTT',
            },
            {
              id: 'redis-primary',
              name: 'Central Redis Cluster',
              layer: 'storage',
              description: 'Single hot shard handling global tenant counters',
              status: 'added',
              metrics: 'Hot-key bottleneck',
            },
          ],
          edges: [
            { from: 'edge-proxy', to: 'redis-primary', protocol: 'GET + SET (2 RTT)', isNew: true },
          ],
        },
      },
      {
        sha: 'bb22cc33dd44ee55ff6677889900aabbccddeeff',
        shortSha: 'bb22cc3',
        parentSha: 'aa11bb22cc33dd44ee55ff6677889900aabbccdd',
        branch: 'main',
        tag: 'v0.5.0',
        title: 'Consolidate into atomic Token Bucket Lua evaluation to eliminate race windows',
        message:
          'Replaces the non-atomic GET/SET pair and fixed-window boundary spike with a continuous-refill Token Bucket evaluated atomically in a single round-trip.',
        author: 'Devon Brooks',
        authorRole: 'Staff Edge Infrastructure Engineer',
        timestamp: '2026-08-24 12:15:40',
        relativeTime: 'Commit 2 of 3',
        category: 'Bugfix',
        isArchitecturalMilestone: false,
        files: [
          {
            path: 'src/ratelimit/GatewayLimiter.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export interface RedisClient {
  get(key: string): Promise<number | null>;
  set(key: string, count: number, ttlSeconds: number): Promise<void>;
}

export class GatewayLimiter {
  constructor(
    private readonly redis: RedisClient,
    private readonly limitPerMinute: number
  ) {}

  public async allowRequest(tenantId: string): Promise<boolean> {
    const minuteBucket = Math.floor(Date.now() / 60000);
    const key = \`rl:\${tenantId}:\${minuteBucket}\`;

    const current = (await this.redis.get(key)) ?? 0;
    if (current >= this.limitPerMinute) {
      return false;
    }

    // Non-atomic read-modify-write + synchronous network RTT on hot path
    await this.redis.set(key, current + 1, 60);
    return true;
  }
}`,
            content: `export interface AtomicTokenStore {
  evalTokenBucket(
    key: string,
    capacity: number,
    refillPerSec: number,
    nowMs: number,
    requested: number
  ): Promise<{ allowed: boolean; remaining: number }>;
}

export class GatewayLimiter {
  constructor(
    private readonly store: AtomicTokenStore,
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {}

  public async allowRequest(tenantId: string, cost = 1): Promise<boolean> {
    const key = \`tb:\${tenantId}\`;
    const result = await this.store.evalTokenBucket(
      key,
      this.capacity,
      this.refillPerSec,
      Date.now(),
      cost
    );
    return result.allowed;
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-02',
          title: 'Single-RTT Atomic Token Bucket Evaluation',
          problemStatement:
            'Concurrent requests slipped past the limit during the GET-then-SET race window, and tenants could burst 2x their quota at XX:59.999 -> XX:00.001.',
          decisionSummary:
            'Collapsed token refill calculation and deduction into a single atomic server-side evaluation.',
          tradeoffs: [
            'Eliminates concurrency race conditions and halves Redis round-trips',
            'Still incurs 1 synchronous network hop on every single incoming HTTP request',
          ],
          measurableOutcome: 'Latency overhead halved to +1.8ms · Zero boundary burst leaks',
          modules: [
            {
              id: 'edge-proxy',
              name: 'Edge Gateway Pod',
              layer: 'edge',
              description: 'Invokes atomic evalTokenBucket in 1 network hop',
              status: 'modified',
              metrics: '+1.8ms RTT',
            },
            {
              id: 'redis-primary',
              name: 'Atomic Lua Token Store',
              layer: 'storage',
              description: 'Computes continuous token refill atomically',
              status: 'modified',
              metrics: '1 RTT atomic',
            },
          ],
          edges: [
            { from: 'edge-proxy', to: 'redis-primary', protocol: 'EVALSHA (1 RTT)', isNew: true },
          ],
        },
      },
      {
        sha: 'cc33dd44ee55ff6677889900aabbccddeeff0011',
        shortSha: 'cc33dd4',
        parentSha: 'bb22cc33dd44ee55ff6677889900aabbccddeeff',
        branch: 'main',
        tag: 'v1.0.0',
        title: 'Introduce local batch token leasing with async background replenishment',
        message:
          'Removes Redis from the synchronous request hot-path. Each edge pod leases batches of 50 tokens locally in memory and refills asynchronously in the background when local reserve drops below 20%.',
        author: 'Devon Brooks',
        authorRole: 'Staff Edge Infrastructure Engineer',
        timestamp: '2026-09-19 19:05:11',
        relativeTime: 'Commit 3 of 3',
        category: 'Performance',
        isArchitecturalMilestone: true,
        files: [
          {
            path: 'src/ratelimit/GatewayLimiter.ts',
            language: 'typescript',
            status: 'modified',
            previousContent: `export interface AtomicTokenStore {
  evalTokenBucket(
    key: string,
    capacity: number,
    refillPerSec: number,
    nowMs: number,
    requested: number
  ): Promise<{ allowed: boolean; remaining: number }>;
}

export class GatewayLimiter {
  constructor(
    private readonly store: AtomicTokenStore,
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {}

  public async allowRequest(tenantId: string, cost = 1): Promise<boolean> {
    const key = \`tb:\${tenantId}\`;
    const result = await this.store.evalTokenBucket(
      key,
      this.capacity,
      this.refillPerSec,
      Date.now(),
      cost
    );
    return result.allowed;
  }
}`,
            content: `export interface AtomicTokenStore {
  leaseTokens(key: string, batchSize: number): Promise<number>;
}

interface LocalLeaseBucket {
  tokens: number;
  refilling: boolean;
}

export class GatewayLimiter {
  private localBuckets = new Map<string, LocalLeaseBucket>();

  constructor(
    private readonly store: AtomicTokenStore,
    private readonly leaseBatchSize: number = 50,
    private readonly lowWatermark: number = 10
  ) {}

  public allowRequestFastPath(tenantId: string, cost = 1): boolean {
    let bucket = this.localBuckets.get(tenantId);
    if (!bucket) {
      bucket = { tokens: this.leaseBatchSize, refilling: false };
      this.localBuckets.set(tenantId, bucket);
    }

    if (bucket.tokens < this.lowWatermark && !bucket.refilling) {
      this.triggerAsyncReplenish(tenantId, bucket);
    }

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }

    return false;
  }

  private triggerAsyncReplenish(tenantId: string, bucket: LocalLeaseBucket): void {
    bucket.refilling = true;
    this.store
      .leaseTokens(\`tb:\${tenantId}\`, this.leaseBatchSize)
      .then((granted) => {
        bucket.tokens += granted;
      })
      .finally(() => {
        bucket.refilling = false;
      });
  }
}`,
          },
        ],
        adr: {
          id: 'ADR-03',
          title: 'Sub-Microsecond In-Memory Token Leasing with Async Watermark Refill',
          problemStatement:
            'Even 1.8ms of Redis network RTT per request was unacceptable for high-throughput gRPC microservices and created a single point of failure when Redis experienced brief network jitter.',
          decisionSummary:
            'Edge pods now lease blocks of 50 tokens into an L1 in-memory Map (`allowRequestFastPath`) and trigger background replenishment when local tokens fall below the 20% watermark.',
          tradeoffs: [
            '0.002ms (2 microsecond) synchronous decision latency and 98% fewer Redis ops',
            'Up to `pods * leaseBatchSize` bounded over-admission slack during sudden global exhaustion',
          ],
          measurableOutcome: 'p99 rate-limit check dropped from 1.8ms to 0.002ms · 50x reduction in Redis load',
          modules: [
            {
              id: 'edge-proxy',
              name: 'Edge Fast-Path Filter',
              layer: 'edge',
              description: 'Checks local memory lease synchronously in 2µs',
              status: 'modified',
              metrics: '0.002ms p99',
            },
            {
              id: 'local-lease',
              name: 'Watermark Lease Cache',
              layer: 'core',
              description: 'Prefetches 50-token leases asynchronously at 20% watermark',
              status: 'added',
              metrics: '98% cache hit',
            },
            {
              id: 'redis-primary',
              name: 'Global Quota Coordinator',
              layer: 'storage',
              description: 'Grants coarse token leases off the request hot-path',
              status: 'modified',
              metrics: '-98% QPS load',
            },
          ],
          edges: [
            { from: 'edge-proxy', to: 'local-lease', protocol: 'In-memory Map lookup', isNew: true },
            { from: 'local-lease', to: 'redis-primary', protocol: 'Async batch lease (50x)', isNew: true },
          ],
        },
      },
    ],
  },
];

export const SAMPLE_RAW_GIT_LOG = `commit a1b2c3d4e5f60123456789abcdef0123456789ab
Author: Maya Lin <maya@acme.dev>
Date:   2026-10-10 11:20:00

    Extract connection pooler with bounded circuit breaker

diff --git a/src/db/Pool.ts b/src/db/Pool.ts
index 1111111..2222222 100644
--- a/src/db/Pool.ts
+++ b/src/db/Pool.ts
@@ -1,6 +1,11 @@
 export class ConnectionPool {
-  private maxConnections = 10;
+  private readonly maxConnections = 25;
+  private activeCount = 0;
+  private circuitOpen = false;
 
   public acquire(): boolean {
-    return true;
+    if (this.circuitOpen || this.activeCount >= this.maxConnections) {
+      return false;
+    }
+    this.activeCount += 1;
+    return true;
   }
 }

commit 89abcdef0123456789abcdef0123456789abcdef
Author: Liam O'Connor <liam@acme.dev>
Date:   2026-10-04 09:05:00

    Initial database connection pool skeleton

diff --git a/src/db/Pool.ts b/src/db/Pool.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/db/Pool.ts
@@ -0,0 +1,6 @@
+export class ConnectionPool {
+  private maxConnections = 10;
+
+  public acquire(): boolean {
+    return true;
+  }
+}`;
