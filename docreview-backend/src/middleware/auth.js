import jwt from "jsonwebtoken";

// Fungsi untuk mengekstrak token dari header Authorization
function extractToken(req) {
  const header = req.headers.authorization || "";
  return header.replace(/^Bearer\s+/i, "").trim();
}

// Fungsi untuk menangani autentikasi opsional
export function authOptional(req, _res, next) {
  const token = extractToken(req);

  // Jika token tidak ada, lanjutkan tanpa menetapkan user
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    // Verifikasi token dengan secret key
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // Set user dari payload token
  } catch (error) {
    console.error("Invalid token:", error);
    req.user = null; // Jika token tidak valid, tidak ada user
  }

  next();
}

// Fungsi untuk menangani autentikasi yang diperlukan
export function authRequired(req, res, next) {
  const token = extractToken(req);

  // Jika token tidak ada, kembalikan respons dengan status 401
  if (!token) {
    return res.status(401).json({ error: "Authorization token is missing" });
  }

  try {
    // Verifikasi token dengan secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next(); 
  } catch (error) {
    console.error("Authorization failed:", error);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
