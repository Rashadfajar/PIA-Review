// src/lib/verifyJwt.js
import jwt from "jsonwebtoken";

export function verifyJwt(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET); // payload: { id, name, ... }
  } catch {
    return null;
  }
}
