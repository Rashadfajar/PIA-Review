// api.js (versi aman)

const RAW_API_BASE =
  (import.meta.env && (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API)) ||
  "";

function normalizeBase(raw) {
  try {
    let base = String(raw || "").trim();
    if (!base) return "http://localhost:4000";
    if (base.startsWith("//")) {
      return `${window.location.protocol}${base}`.replace(/\/+$/, "");
    }
    const u = new URL(base, window.location.origin);
    return u.origin.replace(/\/+$/, "");
  } catch {
    return "http://localhost:4000";
  }
}

export const API_BASE = normalizeBase(RAW_API_BASE);

export function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function withTimeout(ms = 15000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort("timeout"), ms);
  return { signal: ac.signal, done: () => clearTimeout(id) };
}

async function parseJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}

function buildUrl(path) {
  const p = path?.startsWith("/") ? path : `/${path || ""}`;
  return `${API_BASE}${p}`;
}

export async function apiJson(path, { method = "GET", headers = {}, body, timeoutMs = 15000 } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(buildUrl(path), {
      method,
      headers: { "Content-Type": "application/json", ...authHeader(), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError" || err.message === "timeout") throw new Error("Request timeout");
    if (err.message?.includes("Failed to fetch")) throw new Error("Network error (server unreachable)");
    throw err;
  } finally {
    done();
  }
}

export async function apiForm(path, formData, { method = "POST", headers = {}, timeoutMs = 300000 } = {}) {
  const { signal, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(buildUrl(path), {
      method,
      headers: { ...authHeader(), ...headers }, // jangan set Content-Type untuk FormData
      body: formData,
      signal,
    });
    const data = await parseJsonSafe(res);
    if (!res.ok) throw new Error(data?.error || res.statusText || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err.name === "AbortError" || err.message === "timeout") throw new Error("Upload timeout");
    if (err.message?.includes("Failed to fetch")) throw new Error("Network error (server unreachable)");
    throw err;
  } finally {
    done();
  }
}

// === File URL helper ===
export const fileUrl = (file) => {
  const u = file?.absoluteUrl || file?.url || "";
  if (/^https?:\/\//i.test(u)) return u; // sudah absolute (Supabase public URL)
  return u ? buildUrl(u) : "";
};

if (!/^https?:\/\/[^/]+$/i.test(API_BASE)) {
  console.warn("[api] Suspicious API_BASE:", API_BASE, "raw:", RAW_API_BASE);
}
