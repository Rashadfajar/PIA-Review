import jwt from "jsonwebtoken";

/** Ambil token dari Authorization: Bearer <token> atau dari cookie `token` */
function extractToken(req) {
  // 1) Authorization header
  const header = (req.headers.authorization || "").trim();
  if (header) {
    // Format umum: "Bearer <token>"
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();
  }
  // 2) Cookie (jika ada)
  //   - pastikan FE set cookie httpOnly/secure sesuai kebijakanmu
  const cookieHeader = req.headers.cookie || "";
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((p) => {
        const idx = p.indexOf("=");
        if (idx === -1) return [p.trim(), ""];
        return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1))];
      })
    );
    if (cookies.token) return cookies.token;
    if (cookies.access_token) return cookies.access_token; // fallback nama lain
  }
  return "";
}

/** Verifikasi JWT, balikan null kalau gagal */
function verify(token) {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      // toleransi kecil untuk skew waktu jika server & client jamnya beda
      clockTolerance: 5,
    });
    // pastikan minimal ada user id
    if (!payload || !payload.id) return null;
    return payload; // { id, name, email, ... } sesuai saat sign
  } catch {
    return null;
  }
}

/** Auth opsional: set req.user kalau valid, selain itu biarkan null */
export function authOptional(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  const payload = verify(token);
  req.user = payload || null;
  return next();
}

/** Auth wajib: harus ada token valid */
export function authRequired(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authorization token is missing" });
  }
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  req.user = payload;
  return next();
}
