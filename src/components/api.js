// api.js (versi aman)

const RAW_API_BASE =
  (import.meta.env && (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API)) ||
  "";

function normalizeBase(raw) {
  try {
    let base = String(raw || "").trim();

    // Kalau kosong → default ke localhost:4000
    if (!base) return "http://localhost:4000";

    // Izinkan bentuk //host:port → tambahkan protokol saat runtime
    if (base.startsWith("//")) {
      return `${window.location.protocol}${base}`.replace(/\/+$/, "");
    }

    // Kalau cuma port (":4000") atau path relatif → jadikan absolut relatif ke origin FE
    // new URL akan me-resolve relatif dengan benar
    const u = new URL(base, window.location.origin);
    return u.origin.replace(/\/+$/, "");
  } catch {
    // Kalau env tidak valid, fallback aman
    return "http://localhost:4000";
  }
}

export const API_BASE = normalizeBase(RAW_API_BASE);

// Utility header auth
export function authHeader() {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

// Timeout helper
function withTimeout(ms = 15000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort("timeout"), ms);
  return { signal: ac.signal, done: () => clearTimeout(id) };
}

async function parseJsonSafe(res) {
  try { return await res.json(); } catch { return null; }
}

function buildUrl(path) {
  // Pastikan path diawali "/" agar join-nya konsisten
  const p = path?.startsWith("/") ? path : `/${path || ""}`;
  return `${API_BASE}${p}`;
}

// === Request helpers ===
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
    if (err.message?.includes("Failed to fetch") || err.message === "NetworkError when attempting to fetch resource.")
      throw new Error("Network error (server unreachable)");
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

// === File URL helper (paling aman untuk viewer) ===
export const fileUrl = (file) => {
  // Backend-mu sudah mengirim absoluteUrl; pakai itu kalau ada
  if (file?.absoluteUrl) return file.absoluteUrl;
  if (file?.url) return buildUrl(file.url);
  return "";
};

// Optional: warning kalau base-nya tidak absolut (biar gampang debug)
if (!/^https?:\/\/[^/]+$/i.test(API_BASE)) {
  // eslint-disable-next-line no-console
  console.warn("[api] Suspicious API_BASE:", API_BASE, "raw:", RAW_API_BASE);
}
