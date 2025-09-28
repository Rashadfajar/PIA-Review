// src/lib/socket.js
import { io } from "socket.io-client";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) ||
  "http://localhost:4000";

// Jangan auto connect; kita akan connect setelah punya token
export const socket = io(API_BASE, {
  autoConnect: false,
  transports: ["websocket", "polling"], // kasih fallback polling juga
});

// helper: pastikan socket connect dg token terbaru
export function ensureSocketConnected(token) {
  // update token selalu
  socket.auth = { token: token || "" };

  if (!socket.connected) {
    socket.connect();
  }
  return socket;
}
