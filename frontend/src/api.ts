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

function normalizeNetworkError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "");
  if (
    error instanceof TypeError
    || message === "Load failed"
    || message === "Failed to fetch"
    || message === "NetworkError when attempting to fetch resource."
  ) {
    return new Error("无法连接服务器，请检查网络后重试");
  }
  return error instanceof Error ? error : new Error(message || "请求失败");
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

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...options, headers });
  } catch (error) {
    throw normalizeNetworkError(error);
  }
  if (res.status === 401) {
    clearToken();
    window.location.hash = "#/login";
    return null;
  }
  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "请求错误");
  }
  if (res.status === 403) {
    let msg = "未付费";
    try { const body = await res.json(); if (body.error) msg = body.error; } catch {}
    throw new Error(msg);
  }
  if (res.status === 422) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || "验证失败");
    (err as any).body = body;
    throw err;
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
