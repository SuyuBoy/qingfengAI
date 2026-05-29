const TOKEN_KEY = "bili_jwt";
let _token = localStorage.getItem(TOKEN_KEY) || "";

const API_BASE = window.__API_BASE__ || "";

export function setToken(t) { _token = t; localStorage.setItem(TOKEN_KEY, t); }
export function getToken() { return _token; }
export function clearToken() { _token = ""; localStorage.removeItem(TOKEN_KEY); }

async function request(path, options = {}) {
  const headers = { "Cache-Control": "no-cache", ...options.headers };
  if (_token) headers["Authorization"] = "Bearer " + _token;
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  const url = API_BASE + path;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { clearToken(); window.location.hash = "#/login"; return null; }
  if (res.status === 403) { throw new Error("未付费"); }
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

export const api = {
  get: (path, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(qs ? path + "?" + qs : path);
  },
  post: (path, body) => request(path, { method: "POST", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};
