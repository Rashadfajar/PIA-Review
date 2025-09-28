import { Router } from "express";
import { prisma } from "../prisma.js";
import { authRequired } from "../middleware/auth.js";

const router = Router();

router.get("/:fileId", authRequired, async (req, res) => {
  const items = await prisma.section.findMany({
    where: { fileId: req.params.fileId },
    orderBy: { createdAt: "asc" },
  });
  res.json(items);
});

// replace all sections for a file
router.post("/:fileId/replace", authRequired, async (req, res) => {
  const { sections } = req.body || {};
  if (!Array.isArray(sections)) return res.status(400).json({ error: "sections must be array" });

  await prisma.$transaction(async (tx) => {
    await tx.section.deleteMany({ where: { fileId: req.params.fileId } });
    for (const s of sections) {
      await tx.section.create({
        data: {
          fileId: req.params.fileId,
          title: String(s.title || "Untitled"),
          level: Number(s.level ?? 1),
          page: Number(s.page || 1),
          pdfX: s.pdfX ?? null,
          pdfY: s.pdfY ?? null,
          source: String(s.source || "unknown"),
          destJson: s.dest ? JSON.stringify(s.dest) : null,
        },
      });
    }
  });

  res.json({ ok: true });
});

export default router;
