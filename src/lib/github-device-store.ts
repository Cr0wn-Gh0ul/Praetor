import "server-only";

const MAX_DEVICE_SESSIONS = 100;
const sessions = new Map<string, { deviceCode: string; interval: number; expiresAt: number }>();

export function addGitHubDeviceSession(id: string, session: { deviceCode: string; interval: number; expiresAt: number }): boolean {
  for (const [key, value] of sessions) if (value.expiresAt <= Date.now()) sessions.delete(key);
  if (sessions.size >= MAX_DEVICE_SESSIONS) return false;
  sessions.set(id, session);
  return true;
}

export function getGitHubDeviceSession(id: string) {
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function updateGitHubDeviceInterval(id: string, interval: number): void {
  const session = getGitHubDeviceSession(id);
  if (session) session.interval = interval;
}

export function deleteGitHubDeviceSession(id: string): void {
  sessions.delete(id);
}
