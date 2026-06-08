const TOKEN_KEY = "bili_jwt";

let token = localStorage.getItem(TOKEN_KEY) || "";

export const API_BASE =
  window.__API_BASE__ || import.meta.env.VITE_API_BASE || "https://qingfenapiflask-tanwdgitwa.cn-hangzhou.fcapp.run";

export function setToken(nextToken: string) {
  token = nextToken;
  localStorage.setItem(TOKEN_KEY, nextToken);
}

export function getToken() {
  return token;
}

export function clearToken() {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const headers = new Headers(options.headers);
  headers.set("Cache-Control", "no-cache");
  const body = options.body;

  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
    options = { ...options, body: JSON.stringify(body) };
  }

  const res = await fetch(API_BASE + path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.location.hash = "#/login";
    return null;
  }
  if (res.status === 403) {
    let msg = "未付费";
    try { const body = await res.json(); if (body.error) msg = body.error; } catch {}
    throw new Error(msg);
  }
  if (!res.ok) throw new Error(res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, params: Record<string, string | number | boolean> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
    return request<T>(qs ? `${path}?${qs}` : path);
  },
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body as BodyInit }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body as BodyInit }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
