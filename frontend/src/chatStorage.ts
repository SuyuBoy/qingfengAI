import { api } from "./api";
import type { ChatSession } from "./types";

export const SESSIONS_KEY = "chat_sessions";
export const ACTIVE_KEY = "chat_active_session";

interface SessionsResponse {
  sessions: ChatSession[];
}

interface SessionResponse {
  session: ChatSession;
}

export function loadChatSessions() {
  const raw = localStorage.getItem(SESSIONS_KEY);
  if (!raw) return [];
  const sessions = JSON.parse(raw) as ChatSession[];
  return Array.isArray(sessions) ? sessions : [];
}

export function saveChatSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export function getStoredActiveId() {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setStoredActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
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
