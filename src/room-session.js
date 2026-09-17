// sessionStorage survives reloads/browser restoration, but is scoped to this tab.
// Credentials never go in invite URLs or public room snapshots.
export function createRoomSessionStore(serverOrigin, getStorage = () => sessionStorage) {
  const key = `horse-room:${serverOrigin}`;
  return {
    read(inviteCode) {
      try {
        const saved = JSON.parse(getStorage().getItem(key));
        if (!saved || !/^[A-F0-9]{6}$/.test(saved.code) || typeof saved.playerId !== 'string' || typeof saved.resumeToken !== 'string') return null;
        if (inviteCode && inviteCode !== saved.code) return null;
        return saved;
      } catch { return null; }
    },
    write(session) { try { getStorage().setItem(key, JSON.stringify(session)); } catch {} },
    clear() { try { getStorage().removeItem(key); } catch {} }
  };
}
