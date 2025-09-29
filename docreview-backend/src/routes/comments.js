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
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style"],
  });
  return clean.slice(0, max);
}
function isInt(n) {
  const v = Number(n);
  return Number.isInteger(v);
}

/* List comments */
router.get("/:fileId", authRequired, async (req, res) => {
  const access = await canAccessFile(req.user.id, req.params.fileId);
  if (!access.ok) return res.status(access.status).json({ error: access.reason });

  try {
    const items = await prisma.comment.findMany({
      where: { fileId: req.params.fileId },
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
        user: { select: { name: true } },
      },
    });
    res.json(items);
  } catch (err) {
    console.error("Error fetching comments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

/* Add comment*/
router.post("/:fileId", authRequired, async (req, res) => {
  const { sectionTitle, page, lineNo, body, commentType, regionBBox } = req.body;

  if (!isInt(page) || !body || !String(body).trim()) {
    return res.status(400).json({ error: "Invalid page/body" });
  }

  const access = await canAccessFile(req.user.id, req.params.fileId);
  if (!access.ok) return res.status(access.status).json({ error: access.reason });

  try {
    const validTypes = new Set(["GENERAL", "ISSUE", "SUGGESTION"]);
    const safeType = validTypes.has(commentType) ? commentType : "GENERAL";

    const safeBody = sanitizeText(body, 5000);
    const safeSection = sanitizeText(sectionTitle, 300);

    const newComment = await prisma.comment.create({
      data: {
        fileId: req.params.fileId,
        userId: req.user.id,
        page: Number(page),
        lineNo: lineNo != null && isInt(lineNo) ? Number(lineNo) : null,
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

    io.to(`file_${req.params.fileId}`).emit("commentCreated", newComment);
    res.json(newComment);
  } catch (err) {
    console.error("Error adding comment:", err);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

export default router;
