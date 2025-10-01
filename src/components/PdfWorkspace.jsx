import React, { useEffect, useRef, useState, useCallback  } from "react";
import Button from "./ui/Button";
import { API_BASE  } from "./api";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { EventBus, PDFViewer, PDFLinkService } from "pdfjs-dist/web/pdf_viewer";
import * as XLSX from "xlsx";
import { apiJson  } from "./api";
import SectionList from "./SectionList";
import CommentPanel from "./CommentPanel";
import PageInfoChip from "./PageInfoChip";
import {
  SmallSectionToggle,
  SlideOverSections,
  MinimalSectionBox,
  SlideOverComments,
  MinimalCommentDock,
  MinimalCommentBox,
} from "./Overlays";
import { loadState, saveState, uid, nowISO } from "./utils";
import { flattenOutlineRecursive, detectHeadings, detectTOC, detectTOCByLinks } from "./pdfHelpers";
import { socket, ensureSocketConnected } from "../lib/socket";

GlobalWorkerOptions.workerSrc = workerSrc;

function injectPdfCssFixes() {
  if (document.getElementById("__pdf_textlayer_fixes")) return;
  const style = document.createElement("style");
  style.id = "__pdf_textlayer_fixes";
  style.textContent = `
    /* Reset keras untuk presisi posisi glyph & selection */
    .pdfViewer .textLayer,
    .pdfViewer .textLayer * {
      line-height: 1 !important;
      letter-spacing: 0 !important;
      word-spacing: 0 !important;
      font-kerning: none !important;
      font-variant-ligatures: none !important;
      text-rendering: optimizeSpeed !important;
    }
    .pdfViewer .textLayer span {
      position: absolute !important;
      transform-origin: 0 0 !important;
      white-space: pre !important;
      /* cegah style global mengubah ukuran kotak teks */
      box-sizing: content-box !important;
      border: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    /* pastikan canvas & textLayer overlay sinkron */
    .pdfViewer .canvasWrapper, .pdfViewer .textLayer {
      position: absolute !important;
      inset: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

/* ===================== Helpers overlay & seleksi===================== */
function getPageViewAtClient(viewer, clientX, clientY) {
  if (!viewer?._pages?.length) return null;
  for (const pv of viewer._pages) {
    const r = pv?.div?.getBoundingClientRect?.();
    if (!r) continue;
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return { pageView: pv, rect: r };
    }
  }
  return null;
}
function ensureSelectionOverlay(pageView) {
  if (!pageView?.div) return null;
  let ov = pageView.div.querySelector(':scope > .__selectionOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.className = '__selectionOverlay';
    Object.assign(ov.style, {
      position: 'absolute',
      left: '0', top: '0', width: '100%', height: '100%',
      pointerEvents: 'none', 
      zIndex: 50,
    });
    if (!pageView.div.style.position || pageView.div.style.position === 'static') {
      pageView.div.style.position = 'relative';
    }
    pageView.div.appendChild(ov);
  }
  return ov;
}
function drawSelectionBox(overlay, x1, y1, x2, y2) {
  if (!overlay) return;
  let box = overlay.querySelector(':scope > .__selectionBox');
  if (!box) {
    box = document.createElement('div');
    box.className = '__selectionBox';
    Object.assign(box.style, {
      position: 'absolute',
      border: '1px solid rgba(0,0,0,0.6)',
      background: 'rgba(0,120,255,0.15)',
      pointerEvents: 'none',
    });
    overlay.appendChild(box);
  }
  const left = Math.min(x1, x2);
  const top  = Math.min(y1, y2);
  const w    = Math.abs(x1 - x2);
  const h    = Math.abs(y1 - y2);
  Object.assign(box.style, {
    left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`,
    display: (w && h) ? 'block' : 'none',
  });
}
function clearSelectionBox(overlay) {
  const box = overlay?.querySelector?.(':scope > .__selectionBox');
  if (box) box.style.display = 'none';
}

function joinUrl(base, path) {
  if (!base) return path || "";
  if (!path) return base;
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  const encoded = p.split("/").map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join("/");
  return `${b}${encoded}`;
}

export default function PdfWorkspace({ user, file, onBack }) {
  // injeksi CSS 
  useEffect(() => { injectPdfCssFixes(); }, []);

  const viewerContainerRef = useRef(null);
  const viewerRef = useRef(null);
  const eventBusRef = useRef(null);
  const linkServiceRef = useRef(null);

  const [sections, setSections] = useState([]);
  const [activeSection, setActiveSection] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [comments, setComments] = useState([]);
  const [pageLabels, setPageLabels] = useState(null);
  const [loading, setLoading] = useState(true);

  const pagesReadyRef = useRef(false);
  const pendingJumpRef = useRef(null);
  const sectionAnchorsRef = useRef([]);
  const pdfRef = useRef(null);
  const [userState, setUser] = useState(user);


  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const dragRef = useRef({ active: false, pageView: null, startView: [0, 0], overlay: null });

  const getDisplayLabel = (pageNum) => {
    if (pageLabels && pageLabels[pageNum - 1]) return pageLabels[pageNum - 1];
    return String(pageNum);
  };

  const SECTION_ACTIVE_MODE = "OFFSET";
  const SECTION_ACTIVE_OFFSET_PX = 220;
  function getMarkerY(container) {
    if (!container) return 0;
    switch (SECTION_ACTIVE_MODE) {
      case "TOP":    return container.scrollTop;
      case "CENTER": return container.scrollTop + container.clientHeight / 2;
      case "OFFSET":
      default:       return container.scrollTop + SECTION_ACTIVE_OFFSET_PX;
    }
  }

  const fetchUserData = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      const data = await response.json();
      setUser({ ...user, ...data });
    } catch (err) {
      console.error("Failed to fetch user data", err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchUserData(); 
    }
  }, [user]);

  const fetchComments = useCallback(async () => {
    try {
      const data = await apiJson(`/comments/${file.id}`);
      setComments(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Gagal mengambil komentar:", e);
    }
  }, [file.id]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    // 1) connect (lazy) dengan token saat ini
    const s = ensureSocketConnected(user.token);

    // 2) join room setelah benar-benar terhubung
    const onConnect = () => {
      s.emit("joinFile", { fileId: file.id });
    };

    // 3) terima komentar baru
    const onNew = (c) => {
      if (!c || c.fileId !== file.id) return;
      setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
    };

    // 4)logging error koneksi & join
    const onConnectError = (err) => {
      console.warn("socket connect_error:", err?.message || err);
    };
    const onJoinErr = (e) => {
      if (e?.fileId === file.id) console.warn("joinError:", e.reason);
    };

    s.on("connect", onConnect);
    s.on("commentCreated", onNew);
    s.on("connect_error", onConnectError);
    s.on("joinError", onJoinErr);

    // 5) cleanup
    return () => {
      try { s.emit("leaveFile", { fileId: file.id }); } catch {}
      s.off("connect", onConnect);
      s.off("commentCreated", onNew);
      s.off("connect_error", onConnectError);
      s.off("joinError", onJoinErr);
    };
  }, [file.id, user.token]);


  useEffect(() => {
    let canceled = false;
    (async () => {
      setLoading(true);
      try {
        const pdfUrl = (() => {
          // 1) viewUrl dari LibraryView (paling aman)
          if (file.viewUrl && /^https?:\/\//i.test(file.viewUrl)) return file.viewUrl;
          // 2) absoluteUrl dari backend
          if (file.absoluteUrl && /^https?:\/\//i.test(file.absoluteUrl)) return file.absoluteUrl;
          // 3) url sudah absolut
          if (file.url && /^https?:\/\//i.test(file.url)) return file.url;
          // 4) url relatif → gabungkan dengan API_BASE
          return joinUrl(API_BASE, file.url || "");
        })();
        console.log("[PDF] url:", pdfUrl, { file, API_BASE });
        const loadingTask = getDocument({ url: pdfUrl, useSystemFonts: true });

        const _pdf = await loadingTask.promise;
        pdfRef.current = _pdf;
        if (canceled) return;

        const eventBus = new EventBus();
        eventBusRef.current = eventBus;
        const linkService = new PDFLinkService({ eventBus });
        const viewer = new PDFViewer({
          container: viewerContainerRef.current,
          eventBus,
          linkService,
          textLayerMode: 2,
        });
        linkService.setViewer(viewer);
        viewerRef.current = viewer;
        linkServiceRef.current = linkService;

        viewer.setDocument(_pdf);
        linkService.setDocument(_pdf);

        eventBus.on("pagesinit", () => {
          pagesReadyRef.current = true;
          viewerRef.current.currentScaleValue = "page-width";
          refreshSectionAnchors();
          try { (viewerRef.current?._pages || []).forEach(pv => ensureSelectionOverlay(pv)); } catch {}
          if (pendingJumpRef.current) {
            jumpToSection(pendingJumpRef.current);
            pendingJumpRef.current = null;
          }
        });
        eventBus.on("pagechanging", (e) => { if (e?.pageNumber) setCurrentPage(e.pageNumber); });
        eventBus.on("updateviewarea", (e) => {
          const p = e?.location?.pageNumber ?? viewerRef.current?.currentPageNumber;
          if (p) setCurrentPage(p);
        });
        eventBus.on("pagerendered", () => {
          try { (viewerRef.current?._pages || []).forEach(pv => ensureSelectionOverlay(pv)); } catch {}
        });
        eventBus.on("scalechange", () => {
          try { (viewerRef.current?._pages || []).forEach(pv => ensureSelectionOverlay(pv)); } catch {}
        });

        try {
          const labels = await _pdf.getPageLabels();
          if (!canceled) setPageLabels(labels || null);
        } catch {
          if (!canceled) setPageLabels(null);
        }

        // Outline → TOC links → TOC text → Headings → Pages
        let secs = [];
        const outline = await _pdf.getOutline();
        if (outline && outline.length) {
          const flat = await flattenOutlineRecursive(_pdf, outline, 1);
          secs = flat.map((s) => ({
            id: s.id,
            title: s.title,
            level: s.level,
            page: s.loc?.pageNum || 1,
            pdfX: s.loc?.pdfX ?? null,
            pdfY: s.loc?.pdfY ?? null,
            dest: s.explicitDest || null,
            source: "outline",
          }));
        }
        if (!secs.length) {
          const viaLinks = await detectTOCByLinks(_pdf, { maxTOCSpanPages: 8, maxDepth: 2, includeFigures: false });
          if (viaLinks.length) secs = viaLinks.map(s => ({ ...s, source: "toc_link" }));
        }
        if (!secs.length) {
          const viaTOCText = await detectTOC(_pdf, {
            ignoreRomanTokens: true,
            ignorePageLabelsInTOC: true,
            maxTOCSpanPages: 8,
            maxDepth: 2,
          });
          if (viaTOCText.length) secs = viaTOCText.map(s => ({ ...s, source: "toc_text" }));
        }
        if (!secs.length) {
          const heads = await detectHeadings(_pdf, { maxPages: 120 });
          if (heads.length) secs = heads.map(s => ({ ...s, source: "heading" }));
        }
        if (!secs.length) {
          const total = _pdf.numPages;
          secs = Array.from({ length: total }, (_, i) => ({
            id: `sec_auto_${i + 1}`, title: `Page ${i + 1}`, level: 1, page: i + 1, pdfX: 0, pdfY: null, dest: null,
          }));
        }
        setSections(secs);
      } catch (err) {
        console.error("Gagal memuat PDF:", err);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();

    return () => {
      canceled = true;
      try {
        viewerRef.current?.setDocument(null);
        linkServiceRef.current?.setDocument(null);
      } catch {}
    };
  }, [file.id, file.viewUrl, file.absoluteUrl, file.url]);

  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;

    let raf = null;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const markerY = getMarkerY(container);
        const anchors = sectionAnchorsRef.current;
        if (!anchors.length) return;

        let active = anchors[0];
        for (const a of anchors) {
          if (a.absY <= markerY) active = a; else break;
        }
        if (active && active.id !== activeSection) setActiveSection(active.id);
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [activeSection]);

  const refreshSectionAnchors = React.useCallback(() => {
    const v = viewerRef.current;
    const container = viewerContainerRef.current;
    if (!v || !container || !sections.length) return;

    const anchors = [];
    for (const s of sections) {
      const pageView = v._pages?.[s.page - 1];
      if (!pageView) continue;
      const pageTop = pageView.div.offsetTop;
      let vy = 0;
      if (typeof s.pdfY === "number") {
        const [, vy0] = pageView.viewport.convertToViewportPoint(s.pdfX || 0, s.pdfY);
        vy = vy0;
      }
      const absY = pageTop + vy;
      anchors.push({ id: s.id, page: s.page, absY });
    }
    anchors.sort((a, b) => a.absY - b.absY);
    sectionAnchorsRef.current = anchors;
  }, [sections]);

  const refreshTimerRef = useRef(null);
  const scheduleAnchorRefresh = React.useCallback(() => {
    if (refreshTimerRef.current) cancelAnimationFrame(refreshTimerRef.current);
    refreshTimerRef.current = requestAnimationFrame(() => {
      refreshSectionAnchors();
      setTimeout(() => refreshSectionAnchors(), 120);
    });
  }, [refreshSectionAnchors]);

  useEffect(() => {
    const bus = eventBusRef.current;
    if (!bus) return;
    const onScaleChange = () => scheduleAnchorRefresh();
    const onPageRendered = () => scheduleAnchorRefresh();
    bus.on("scalechanging", onScaleChange);
    bus.on("scalechange", onScaleChange);
    bus.on("pagerendered", onPageRendered);
    return () => {
      bus.off?.("scalechanging", onScaleChange);
      bus.off?.("scalechange", onScaleChange);
      bus.off?.("pagerendered", onPageRendered);
    };
  }, [scheduleAnchorRefresh]);

  useEffect(() => {
    if (!viewerRef.current) return;
    requestAnimationFrame(() => {
      try { eventBusRef.current?.dispatch?.("resize", { source: window }); } catch {}
      try { window.dispatchEvent(new Event("resize")); } catch {}
      const v = viewerRef.current;
      const prev = v.currentScaleValue;
      if (prev) v.currentScaleValue = prev; else v.currentScale = v.currentScale;
      scheduleAnchorRefresh();
    });
  }, [isFullscreen, scheduleAnchorRefresh]);  

  const addComment = async ({ section_id, page, line_no, body, comment_type, region_bbox }) => {
    if (!String(body || "").trim()) return;

    const section_title = section_id
      ? sections.find((s) => s.id === section_id)?.title || null
      : null;

    const payload = {
      sectionTitle: section_title,
      page,
      lineNo: line_no ?? null,
      body,
      commentType: comment_type || "GENERAL",
      regionBBox: region_bbox ?? null,
    };

    const data = await apiJson(`/comments/${file.id}`, {
      method: "POST",
      body: payload,
    });

    setComments((prev) => (prev.some((x) => x.id === data.id) ? prev : [data, ...prev]));
    return data;
  };


  const exportExcel = async () => {
    try {
      const commentsFromDb = await apiJson(`/comments/${file.id}`);
      const sanitizeForExcel = (v = "") => {
        const s = String(v ?? "");
        return /^[=+\-@]/.test(s) ? `'${s}` : s;
 
      };

      const rows = commentsFromDb.map((c) => ({
        Section: sanitizeForExcel(c.sectionTitle || c.section?.title || ""),
        "Hal (PDF)": c.page,
        // Line: c.lineNo ?? c.line_no ?? "-",
        Komentar: sanitizeForExcel(c.body),
        User: sanitizeForExcel(c.user?.name || c.user_name || ""),
        Waktu: new Date(c.createdAt || c.created_at).toLocaleString(),
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Comments");
      XLSX.writeFile(wb, `${file.name.replace(/\.pdf$/i, "")}_comments.xlsx`);
    } catch (error) {
      console.error("Failed to export comments to Excel:", error);
    }
  };

  const SECTION_OFFSET_PX = 220;
  const jumpToSection = (s) => {
    if (!pagesReadyRef.current) { pendingJumpRef.current = s; return; }
    const v = viewerRef.current;
    const container = viewerContainerRef.current;
    if (!v || !container) return;

    if ((s.source === "toc_link" || s.source === "toc_text") && s.dest && v.scrollPageIntoView) {
      try {
        v.scrollPageIntoView({ pageNumber: s.page, destArray: s.dest });
        if (SECTION_OFFSET_PX > 0) {
          requestAnimationFrame(() => {
            const t = Math.max(0, container.scrollTop - SECTION_OFFSET_PX);
            container.scrollTo({ top: t, behavior: "instant" });
          });
        }
        setActiveSection(s.id);
        setCurrentPage(s.page);
        return;
      } catch {}
    }

    const pageView = v._pages?.[s.page - 1];
    if (!pageView) {
      linkServiceRef.current?.goToPage(s.page);
      setActiveSection(s.id);
      setCurrentPage(s.page);
      return;
    }

    refreshSectionAnchors();
    const anchors = sectionAnchorsRef.current;
    const found = anchors.find((a) => a.id === s.id);

    if (found) {
      const offsetFactor = 0.35;
      const target = Math.max(0, found.absY - container.clientHeight * offsetFactor);
      container.scrollTo({ top: target, behavior: "smooth" });
    } else if (s.dest && v.scrollPageIntoView) {
      v.scrollPageIntoView({ pageNumber: s.page, destArray: s.dest });
    } else {
      linkServiceRef.current?.goToPage(s.page);
    }

    setActiveSection(s.id);
    setCurrentPage(s.page);
  };

  const reloadPdf = async () => {
    if (!file?.url) return;
    setLoading(true);
    try {
      const pdfUrl = (() => {
        // 1) viewUrl dari LibraryView (paling aman)
        if (file.viewUrl && /^https?:\/\//i.test(file.viewUrl)) return file.viewUrl;
        // 2) absoluteUrl dari backend
        if (file.absoluteUrl && /^https?:\/\//i.test(file.absoluteUrl)) return file.absoluteUrl;
        // 3) url sudah absolut
        if (file.url && /^https?:\/\//i.test(file.url)) return file.url;
        // 4) url relatif → gabungkan dengan API_BASE
        return joinUrl(API_BASE, file.url || "");
      })();
      console.log("[PDF] url:", pdfUrl, { file, API_BASE });
      const loadingTask = getDocument({ url: pdfUrl, useSystemFonts: true });
      const _pdf = await loadingTask.promise;
      pdfRef.current = _pdf;

      const viewer = viewerRef.current;
      const linkService = linkServiceRef.current;

      if (viewer) viewer.setDocument(_pdf);
      if (linkService) linkService.setDocument(_pdf);

      refreshSectionAnchors();
    } catch (err) {
      console.error("Gagal reload PDF:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const container = viewerContainerRef.current;
    const v = viewerRef.current;
    if (!container || !v) return;

    const onMouseDown = (e) => {
      if (!e.altKey) return; // hanya aktif saat ALT
      const hit = getPageViewAtClient(v, e.clientX, e.clientY);
      if (!hit) return;
      const { pageView, rect } = hit;
      const overlay = ensureSelectionOverlay(pageView);
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      dragRef.current = { active: true, pageView, startView: [x, y], overlay };
      e.preventDefault(); 
    };

    const onMouseMove = (e) => {
      const d = dragRef.current;
      if (!d.active || !d.pageView || !d.overlay) return;
      const rect = d.pageView.div.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      drawSelectionBox(d.overlay, d.startView[0], d.startView[1], x, y);
    };

    const onMouseUp = (e) => {
      const d = dragRef.current;
      if (!d.active || !d.pageView) return;
      const rect = d.pageView.div.getBoundingClientRect();
      const x2 = e.clientX - rect.left;
      const y2 = e.clientY - rect.top;
      const [x1, y1] = d.startView;
      const vp = d.pageView.viewport;
      const [pdfX1, pdfY1] = vp.convertToPdfPoint(x1, y1);
      const [pdfX2, pdfY2] = vp.convertToPdfPoint(x2, y2);
      const pdfRect = {
        page: d.pageView.id,
        x1: Math.min(pdfX1, pdfX2),
        y1: Math.min(pdfY1, pdfY2),
        x2: Math.max(pdfX1, pdfX2),
        y2: Math.max(pdfY1, pdfY2),
      };
      clearSelectionBox(d.overlay);
      dragRef.current = { active: false, pageView: null, startView: [0, 0], overlay: null };
    };

    container.addEventListener('mousedown', onMouseDown, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const zoomIn  = () => { if (!viewerRef.current) return; viewerRef.current.currentScale *= 1.1; scheduleAnchorRefresh(); };
  const zoomOut = () => { if (!viewerRef.current) return; viewerRef.current.currentScale /= 1.1; scheduleAnchorRefresh(); };
  const fitWidth = () => { if (!viewerRef.current) return; viewerRef.current.currentScaleValue = "page-width"; scheduleAnchorRefresh(); };
  const fitPage  = () => { if (!viewerRef.current) return; viewerRef.current.currentScaleValue = "page-fit";   scheduleAnchorRefresh(); };

  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-16 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <Button className="px-3 py-1 border rounded-lg" onClick={onBack}>← Library</Button>
          <div className="font-semibold">{file.name}</div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Button className="px-2 border rounded" onClick={zoomOut}>-</Button>
          <Button className="px-2 border rounded" onClick={zoomIn}>+</Button>
          <Button className="px-2 border rounded" onClick={fitWidth}>Fit W</Button>
          <Button className="px-2 border rounded" onClick={fitPage}>Fit P</Button>
          <Button
            className="px-2 border rounded"
            onClick={() => setIsFullscreen(v => { const next = !v; if (!next) { setCommentsOpen(false); setSectionsOpen(false); } return next; })}
            title="Toggle Fullscreen PDF"
          >
            {isFullscreen ? "Exit Full" : "Full PDF"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="flex h-[calc(100vh-64px)]">
          {!isFullscreen && (
            <SectionList
              sections={sections}
              onJump={jumpToSection}
              activeId={activeSection}
              getDisplayLabel={getDisplayLabel}
            />
          )}

          <div className="relative flex-1">
            <div ref={viewerContainerRef} className="absolute inset-0 overflow-auto bg-neutral-500">
              <div className="pdfViewer"></div>
              {loading && (
                <div className="pdf-floating absolute inset-0 flex items-center justify-center bg-black/30 text-white text-lg font-semibold">
                  Loading PDF...
                </div>
              )}
            </div>

            {!isFullscreen && (
              <div className="pdf-floating pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-30">
                <div className="rounded-full border bg-white/90 backdrop-blur px-3 py-1 text-xs shadow">
                  <b>Page</b>:<b>{currentPage}</b>
                </div>
              </div>
            )}

            {isFullscreen && <PageInfoChip pageNumber={currentPage} />}
            {isFullscreen && <SmallSectionToggle onOpen={() => setSectionsOpen(true)} />}
            {isFullscreen && <MinimalCommentDock onExpand={() => setCommentsOpen(true)} comments={comments} />}
          </div>

          {!isFullscreen && (
            <CommentPanel
              user={user}
              file={file}
              sections={sections}
              page={currentPage}
              onAdd={addComment}
              comments={comments}
              onExport={exportExcel}
              activeSectionId={activeSection}
              onRequestJumpSection={jumpToSection}
              getDisplayLabel={getDisplayLabel}
              onReload={fetchComments}
            />
          )}
        </div>
      </div>

      {isFullscreen && (
        <SlideOverSections open={sectionsOpen} onClose={() => setSectionsOpen(false)}>
          <MinimalSectionBox
            sections={sections}
            activeId={activeSection}
            onJump={(s) => { setSectionsOpen(false); jumpToSection(s); }}
            getDisplayLabel={getDisplayLabel}
          />
        </SlideOverSections>
      )}

      {isFullscreen && (
        <SlideOverComments open={commentsOpen} onClose={() => setCommentsOpen(false)}>
          <MinimalCommentBox
            sections={Array.isArray(sections) ? sections : []}
            page={currentPage}
            onAdd={addComment}
            getDisplayLabel={getDisplayLabel}
            onClose={() => setCommentsOpen(false)}
            activeSectionId={activeSection}
            onRequestJumpSection={jumpToSection}
          />
        </SlideOverComments>
      )}
    </div>
  );
}
