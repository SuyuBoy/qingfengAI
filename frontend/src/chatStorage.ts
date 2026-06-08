import { api } from "./api";
import type { ChatSession } from "./types";

export const SESSIONS_KEY = "chat_sessions";
export const ACTIVE_KEY = "chat_active_session";

function scopedKey(key: string, email?: string | null) {
  const account = (email || "anonymous").trim().toLowerCase();
  return `${key}:${account || "anonymous"}`;
}

interface SessionsResponse {
  sessions: ChatSession[];
}

interface SessionResponse {
  session: ChatSession;
}

export function loadChatSessions(email?: string | null) {
  const raw = localStorage.getItem(scopedKey(SESSIONS_KEY, email));
  if (!raw) return [];
  const sessions = JSON.parse(raw) as ChatSession[];
  return Array.isArray(sessions) ? sessions : [];
}

export function saveChatSessions(sessions: ChatSession[], email?: string | null) {
  localStorage.setItem(scopedKey(SESSIONS_KEY, email), JSON.stringify(sessions));
}

export function getStoredActiveId(email?: string | null) {
  return localStorage.getItem(scopedKey(ACTIVE_KEY, email));
}

export function setStoredActiveId(id: string | null, email?: string | null) {
  const key = scopedKey(ACTIVE_KEY, email);
  if (id) localStorage.setItem(key, id);
  else localStorage.removeItem(key);
}

export function clearAllLocalChatSessions() {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (
      key === SESSIONS_KEY ||
      key === ACTIVE_KEY ||
      key?.startsWith(`${SESSIONS_KEY}:`) ||
      key?.startsWith(`${ACTIVE_KEY}:`)
    ) {
      keys.push(key);
    }
  }
  keys.forEach(key => localStorage.removeItem(key));
}

export function mergeChatSessions(remote: ChatSession[], local: ChatSession[]) {
  const localById = new Map(local.map(session => [session.id, session]));
  return remote.map(session => {
    const cached = localById.get(session.id);
    if (session.messages?.length) return session;
    return cached ? { ...session, messages: cached.messages || [] } : { ...session, messages: [] };
  });
}

export async function fetchChatSessions() {
  const data = await api.get<SessionsResponse>("/api/chat/sessions");
  if (!data) throw new Error("会话列表加载失败");
  return data.sessions || [];
}

export async function fetchChatSession(id: string) {
  const data = await api.get<SessionResponse>(`/api/chat/sessions/${encodeURIComponent(id)}`);
  if (!data) throw new Error("会话加载失败");
  return data.session || null;
}

export async function saveRemoteChatSession(session: ChatSession) {
  const data = await api.put<SessionResponse>(`/api/chat/sessions/${encodeURIComponent(session.id)}`, session);
  if (!data) throw new Error("会话保存失败");
  return data.session || null;
}

export async function importLocalChatSessions(sessions: ChatSession[]) {
  const data = await api.post<SessionsResponse & { ok: boolean; imported: number }>("/api/chat/sessions/import", { sessions });
  if (!data) throw new Error("会话导入失败");
  return data.sessions || [];
}

export async function deleteRemoteChatSession(id: string) {
  await api.delete(`/api/chat/sessions/${encodeURIComponent(id)}`);
}
