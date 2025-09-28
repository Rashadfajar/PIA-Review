import React, { useEffect, useState } from "react";
import Button from "./ui/Button";
import useSpeechToText from "../hooks/useSpeechToText";

/* Small toggle Button (fullscreen) */
export function SmallSectionToggle({ onOpen }) {
  return (
    <Button
      className="fixed z-40 top-20 left-4 px-2.5 py-1.5 text-xs rounded-lg border bg-white/90 backdrop-blur shadow hover:bg-white pointer-events-auto"
      onClick={onOpen}
      title="Buka Sections"
      aria-label="Buka Sections"
    >
      ☰
    </Button>
  );
}

export function SlideOverSections({ open, onClose, children }) {
  return (
    <div className="fixed z-50 top-16 left-0 bottom-0 transition-transform pointer-events-none">
      <div
        className={`h-full w-[15rem] max-w-[90vw] bg-white/90 backdrop-blur border-r shadow-2xl rounded-r-xl ${
          open ? "translate-x-0" : "-translate-x-full"
        } pointer-events-auto transition-transform duration-300`}
        role="dialog"
        aria-modal="false"
      >
        <div className="h-9 flex items-center justify-between px-3 border-b">
          <div className="font-medium text-sm">Sections</div>
          <Button className="text-xs px-2 py-1 rounded border" onClick={onClose}>
            Tutup
          </Button>
        </div>
        <div className="h-[calc(100%-2.25rem)] overflow-auto">{children}</div>
      </div>
    </div>
  );
}

export function MinimalSectionBox({ sections, activeId, onJump, getDisplayLabel }) {
  const safe = Array.isArray(sections) ? sections : [];
  const label = (p) => (getDisplayLabel ? getDisplayLabel(p) : String(p));
  return (
    <div className="p-2">
      <div className="space-y-1">
        {safe.length ? (
          safe.map((s) => (
            <Button
              key={s.id}
              className={`w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-sm ${
                activeId === s.id ? "bg-gray-100 font-medium" : ""
              }`}
              title={s.title}
              onClick={() => {
                onJump?.(s);
              }}
            >
              {s.title}
              <span className="text-[11px] text-gray-500 ml-1">[{label(s.page)}]</span>
            </Button>
          ))
        ) : (
          <div className="text-xs text-gray-500 px-2">Tidak ada outline.</div>
        )}
      </div>
    </div>
  );
}

export function SlideOverComments({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div
      className="fixed z-50 bottom-4 right-4 w-60 max-w-[90vw] max-h-[75vh] bg-white/80 backdrop-blur-md border shadow-2xl rounded-xl flex flex-col overflow-hidden transition-all duration-200"
      role="dialog"
      aria-modal="false"
    >
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}

export function MinimalCommentDock({ onExpand, comments }) {
  const safe = Array.isArray(comments) ? comments : [];
  // TERBARU → index 0 (karena state di parent prepend)
  const latest = safe.length ? safe[0] : null;

  return (
    <div className="absolute bottom-4 right-4 z-40">
      <div className="bg-white/70 backdrop-blur-md border shadow-xl rounded-xl w-40 max-w-[80vw]">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <div className="text-sm font-medium">Komentar</div>
          <Button className="text-xs px-2 py-1 border rounded" onClick={onExpand}>
            Buka
          </Button>
        </div>
        <div className="p-3 text-xs text-gray-600">
          {latest ? (
            <>
              <div className="font-medium mb-1">Terbaru</div>
              <div className="line-clamp-2">{latest.body}</div>
            </>
          ) : (
            <div>Belum ada komentar.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MinimalCommentBox({
  sections = [],
  page,
  onAdd,
  getDisplayLabel,
  onClose,
  activeSectionId,
  onRequestJumpSection,
}) {
  const [sectionId, setSectionId] = useState(activeSectionId || "");
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    setSectionId(activeSectionId || "");
  }, [activeSectionId]);

  const submit = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    try {
      await Promise.resolve(
        onAdd?.({
          section_id: sectionId || null,
          page,
          line_no: null,
          body,
          comment_type: "GENERAL", // gunakan enum yang valid di backend
          region_bbox: null,
        })
      );
      setText("");
    } catch (err) {
      console.error("Tambah komentar gagal:", err);
    } finally {
      setPosting(false);
    }
  };

  const { supported, listening, interimText, toggle } = useSpeechToText({
    lang: "id-ID",
    onFinal: (t) => setText((prev) => (prev ? prev + " " + t : t)),
  });

  // Shortcut keyboard: Ctrl+Shift+M mic, Ctrl+Enter submit
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggle();
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, submit]);

  const label = (p) => (getDisplayLabel ? getDisplayLabel(p) : String(p));

  return (
    <div className="h-full flex flex-col">
      <div className="h-10 flex items-center justify-between px-3 border-b sticky top-0 bg-white/80 backdrop-blur-md z-10">
        <div className="font-medium text-sm">Tambah Komentar</div>
        <Button className="text-sm px-2 py-1 rounded border" onClick={onClose}>
          Tutup
        </Button>
      </div>

      <div className="p-3 space-y-2 text-sm overflow-auto">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500">Section</label>
            <select
              className="w-full border rounded p-1"
              value={sectionId}
              onChange={(e) => {
                const val = e.target.value;
                setSectionId(val);
                if (val) {
                  const sec = sections.find((s) => s.id === val);
                  if (sec && onRequestJumpSection) onRequestJumpSection(sec);
                }
              }}
            >
              <option value="">(none)</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500">Page</label>
            <input className="w-full border rounded p-1" value={label(page) || ""} readOnly />
          </div>
        </div>

        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-gray-500">Komentar</label>
            <Button
              type="Button"
              onClick={toggle}
              disabled={!supported}
              title={supported ? "Gunakan suara (Ctrl+Shift+M)" : "Browser tidak mendukung SpeechRecognition"}
              className={`px-2 py-1 text-xs rounded border ${
                listening ? "bg-red-600 text-white border-red-600" : "bg-white"
              }`}
            >
              {listening ? "● Stop" : "🎤 Mic"}
            </Button>
          </div>

          <textarea
            className="w-full border rounded p-2 text-sm"
            rows={4}
            placeholder="Tulis komentar…"
            value={text + (interimText ? " " + interimText : "")}
            onChange={(e) => setText(e.target.value)}
          />

          {!supported && (
            <div className="text-[11px] text-amber-700 mt-1">
              Browser tidak mendukung SpeechRecognition (gunakan Chrome/Edge via HTTPS atau http://localhost).
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            className="px-3 py-1 bg-black text-white rounded-lg disabled:opacity-60"
            onClick={submit}
            disabled={posting}
            title="Ctrl+Enter untuk submit"
          >
            {posting ? "Menyimpan…" : "Tambah"}
          </Button>
        </div>
      </div>
    </div>
  );
}
