import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

import authRoutes from "./routes/auth.js";
import fileRoutes from "./routes/files.js";
import commentRoutes from "./routes/comments.js";
import sectionRoutes from "./routes/sections.js";
import { authOptional } from "./middleware/auth.js";
import { verifyJwt } from "./Lib/verifyJwt.js";
import { canAccessFile } from "./Lib/canAccessFile.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json({ limit: "10mb" }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN, 
    credentials: true,
  })
);
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
app.use("/uploads", express.static(path.resolve(__dirname, "..", uploadDir)));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRoutes);
app.use("/files", authOptional, fileRoutes);
app.use("/comments", authOptional, commentRoutes);
app.use("/sections", authOptional, sectionRoutes);

/* ========= Socket.IO setup ========= */
const server = http.createServer(app);

export const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// 🔐 autentikasi JWT 
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const user = verifyJwt(token);
    if (!user?.id) return next(new Error("unauthorized"));
    socket.user = { id: user.id, name: user.name };
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

// cek akses saat join room per file
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id, "user:", socket.user?.id);

  socket.on("joinFile", async ({ fileId }) => {
    if (!fileId) return;
    try {
      const access = await canAccessFile(socket.user.id, fileId);
      if (!access.ok) {
        socket.emit("joinError", { fileId, reason: access.reason });
        return;
      }
      socket.join(`file_${fileId}`);
    } catch {
      socket.emit("joinError", { fileId, reason: "Internal error" });
    }
  });

  socket.on("leaveFile", ({ fileId }) => {
    if (fileId) socket.leave(`file_${fileId}`);
  });
});
/* =================================== */

const port = Number(process.env.PORT || 4000);
server.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
