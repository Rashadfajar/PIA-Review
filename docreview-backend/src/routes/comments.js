import { Router } from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../middleware/auth.js";
import { canAccessFile } from "../Lib/canAccessFile.js";
import { io } from "../server.js";
import xss from "xss";

const router = Router();

/* Helpers */
function sanitizeText(s, max = 5000) {
  if (s == null) return null;
  const clean = xss(String(s), {
    whiteList: {}, // gunakan allowList jika versi xss kamu lebih baru
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
  });
  return clean.slice(0, max);
}
function isIntLike(n) {
  if (n === null || n === undefined) return false;
  const v = Number(n);
  return Number.isInteger(v);
}

/* =========================
   GET /comments/:fileId
   ========================= */
router.get("/:fileId", authRequired, async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ error: "fileId required" });

    // akses DI DALAM try/catch agar tidak melempar 500
    const access = await canAccessFile(req.user.id, fileId);
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.reason || "Forbidden" });
    }

    const items = await prisma.comment.findMany({
      where: { fileId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        fileId: true,
        page: true,
        lineNo: true,
        body: true,
        commentType: true,
        sectionTitle: true,
        createdAt: true,
        user: { select: { name: true } }, // pastikan relasi 'user' ada di schema
      },
    });

    return res.json(items);
  } catch (err) {
    console.error("Error fetching comments:", err);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
});

/* =========================
   POST /comments/:fileId
   ========================= */
router.post("/:fileId", authRequired, async (req, res) => {
  try {
    const { fileId } = req.params;
    const { sectionTitle, page, lineNo, body, commentType, regionBBox } = req.body;

    if (!fileId) return res.status(400).json({ error: "fileId required" });
    if (!isIntLike(page) || !body || !String(body).trim()) {
      return res.status(400).json({ error: "Invalid page/body" });
    }

    const access = await canAccessFile(req.user.id, fileId);
    if (!access.ok) {
      return res.status(access.status || 403).json({ error: access.reason || "Forbidden" });
    }

    const validTypes = new Set(["GENERAL", "ISSUE", "SUGGESTION"]);
    const safeType = validTypes.has(commentType) ? commentType : "GENERAL";
    const safeBody = sanitizeText(body, 5000);
    const safeSection = sanitizeText(sectionTitle, 300);

    const newComment = await prisma.comment.create({
      data: {
        fileId,
        userId: req.user.id,
        page: Number(page),
        lineNo: lineNo != null && isIntLike(lineNo) ? Number(lineNo) : null,
        body: safeBody,
        commentType: safeType,
        regionJson: regionBBox ? JSON.stringify(regionBBox) : null,
        sectionTitle: safeSection,
      },
      select: {
        id: true,
        fileId: true,
        page: true,
        lineNo: true,
        body: true,
        commentType: true,
        sectionTitle: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    // Emit aman (jangan sampai bikin 500)
    try {
      if (io?.to) {
        io.to(`file_${fileId}`).emit("commentCreated", newComment);
      }
    } catch (emitErr) {
      console.warn("Socket emit failed (non-fatal):", emitErr?.message);
    }

    return res.json(newComment);
  } catch (err) {
    console.error("Error adding comment:", err);
    return res.status(500).json({ error: "Failed to add comment" });
  }
});

export default router;
