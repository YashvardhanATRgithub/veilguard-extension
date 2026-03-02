const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 250;
const DEFAULT_MAX_MAPPINGS = 400;
const DEFAULT_MAX_SESSION_BYTES = 512 * 1024;

function mappingSizeBytes(mapping) {
  const typeLen = String(mapping.type || '').length;
  const realLen = String(mapping.real || '').length;
  const fakeLen = String(mapping.fake || '').length;
  // Approximate object/map overhead + UTF-16 bytes.
  return 96 + (typeLen + realLen + fakeLen) * 2;
}

export class SessionStore {
  constructor(config = {}) {
    this.sessions = new Map();
    this.configure(config);
  }

  configure(config = {}) {
    this.ttlMs = Number.isFinite(config.ttlMs) ? config.ttlMs : DEFAULT_TTL_MS;
    this.maxSessions = Number.isFinite(config.maxSessions) ? config.maxSessions : DEFAULT_MAX_SESSIONS;
    this.maxMappingsPerSession = Number.isFinite(config.maxMappingsPerSession)
      ? config.maxMappingsPerSession
      : DEFAULT_MAX_MAPPINGS;
    this.maxSessionBytesApprox = Number.isFinite(config.maxSessionBytesApprox)
      ? config.maxSessionBytesApprox
      : DEFAULT_MAX_SESSION_BYTES;
    this.prune();
  }

  getSessionKey({ tabId, origin, conversationId }) {
    const safeTab = Number.isFinite(tabId) ? tabId : -1;
    const safeOrigin = origin || 'unknown-origin';
    const convo = conversationId ? String(conversationId) : 'default';
    return `${safeTab}::${safeOrigin}::${convo}`;
  }

  _ensureSession(sessionKey, meta = {}) {
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        sessionKey,
        tabId: meta.tabId ?? -1,
        origin: meta.origin ?? 'unknown-origin',
        conversationId: meta.conversationId ?? 'default',
        createdAt: Date.now(),
        lastAccess: Date.now(),
        fakeToReal: new Map(),
        entityToFake: new Map(),
        approxBytes: 0
      };
      this.sessions.set(sessionKey, session);
    }
    session.lastAccess = Date.now();
    if (Number.isFinite(meta.tabId)) session.tabId = meta.tabId;
    if (meta.origin) session.origin = meta.origin;
    if (meta.conversationId) session.conversationId = meta.conversationId;
    if (!Number.isFinite(session.approxBytes)) {
      let bytes = 0;
      for (const row of session.fakeToReal.values()) {
        bytes += mappingSizeBytes(row);
      }
      session.approxBytes = bytes;
    }
    return session;
  }

  touchSession(sessionKey) {
    const session = this.sessions.get(sessionKey);
    if (!session) return;
    session.lastAccess = Date.now();
  }

  getExistingFake(sessionKey, type, realValue) {
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    const entityKey = `${type}:${realValue}`;
    const fake = session.entityToFake.get(entityKey);
    return fake || null;
  }

  getRealForFake(sessionKey, fakeValue) {
    const session = this.sessions.get(sessionKey);
    if (!session) return null;
    const row = session.fakeToReal.get(fakeValue);
    return row?.real || null;
  }

  setMapping(sessionKey, mapping, meta = {}) {
    const session = this._ensureSession(sessionKey, meta);
    const entityKey = `${mapping.type}:${mapping.real}`;
    const previousFakeForEntity = session.entityToFake.get(entityKey);
    if (previousFakeForEntity) {
      const previous = session.fakeToReal.get(previousFakeForEntity);
      if (previous) {
        session.approxBytes -= mappingSizeBytes(previous);
      }
      session.fakeToReal.delete(previousFakeForEntity);
    }

    const existingForFake = session.fakeToReal.get(mapping.fake);
    if (existingForFake && `${existingForFake.type}:${existingForFake.real}` !== entityKey) {
      session.entityToFake.delete(`${existingForFake.type}:${existingForFake.real}`);
      session.approxBytes -= mappingSizeBytes(existingForFake);
      session.fakeToReal.delete(mapping.fake);
    }

    const row = {
      type: mapping.type,
      real: mapping.real,
      fake: mapping.fake,
      createdAt: mapping.createdAt || Date.now()
    };

    session.entityToFake.set(entityKey, mapping.fake);
    session.fakeToReal.set(mapping.fake, row);
    session.approxBytes += mappingSizeBytes(row);

    this._trimSession(session);

    this.prune();
  }

  _trimSession(session) {
    if (
      session.fakeToReal.size <= this.maxMappingsPerSession &&
      session.approxBytes <= this.maxSessionBytesApprox
    ) {
      return;
    }

    const sorted = [...session.fakeToReal.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [fake, row] of sorted) {
      if (
        session.fakeToReal.size <= this.maxMappingsPerSession &&
        session.approxBytes <= this.maxSessionBytesApprox
      ) {
        break;
      }
      session.fakeToReal.delete(fake);
      session.entityToFake.delete(`${row.type}:${row.real}`);
      session.approxBytes -= mappingSizeBytes(row);
    }

    if (session.approxBytes < 0) session.approxBytes = 0;
  }

  getFakeToRealMap({ sessionKey, tabId, origin }) {
    this.prune();

    if (sessionKey && this.sessions.has(sessionKey)) {
      const session = this.sessions.get(sessionKey);
      session.lastAccess = Date.now();
      return Object.fromEntries([...session.fakeToReal.entries()].map(([fake, row]) => [fake, row.real]));
    }

    const merged = new Map();
    const now = Date.now();
    for (const session of this.sessions.values()) {
      const tabMatches = Number.isFinite(tabId) ? session.tabId === tabId : true;
      const originMatches = origin ? session.origin === origin : true;
      if (!tabMatches || !originMatches) continue;
      session.lastAccess = now;
      for (const [fake, row] of session.fakeToReal.entries()) {
        if (!merged.has(fake)) merged.set(fake, row.real);
      }
    }

    return Object.fromEntries(merged.entries());
  }

  clearTab(tabId) {
    for (const [key, session] of this.sessions.entries()) {
      if (session.tabId === tabId) this.sessions.delete(key);
    }
  }

  clearAll() {
    this.sessions.clear();
  }

  prune() {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.lastAccess > this.ttlMs) {
        this.sessions.delete(key);
      }
    }

    if (this.sessions.size <= this.maxSessions) return;
    const sorted = [...this.sessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const overflow = this.sessions.size - this.maxSessions;
    for (let i = 0; i < overflow; i += 1) {
      this.sessions.delete(sorted[i][0]);
    }
  }
}
