import React, { useEffect, useState } from "react";
import Button from "./ui/Button";
import useSpeechToText from "../hooks/useSpeechToText";

export default function CommentPanel({
  user,
  file,
  sections,
  page,
  onAdd,
  comments,
  onExport,
  activeSectionId,
  onRequestJumpSection,
  getDisplayLabel,
  onReload,    // tambahan dari parent
}) {
  const [sectionId, setSectionId] = useState("");
  const [text, setText] = useState("");
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    setSectionId(activeSectionId ?? "");
  }, [activeSectionId]);

  useEffect(() => {
    setText("");
  }, [page]);

  const submit = async () => {
    if (!text.trim()) return;

    await onAdd({
      section_id: sectionId || null,
      page,
      line_no: null,
      body: text,
      comment_type: "GENERAL",
      region_bbox: null,
    });

    setText("");
  };

  const onChangeSection = (e) => {
    const val = e.target.value;
    setSectionId(val);
    if (!val) return;
    const sec = sections.find((s) => s.id === val);
    if (sec && onRequestJumpSection) onRequestJumpSection(sec);
  };

  const { supported, listening, interimText, toggle } = useSpeechToText({
    lang: "id-ID",
    onFinal: (t) => setText((prev) => (prev ? prev + " " + t : t)),
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const handleReload = async () => {
    if (!onReload) return;
    try {
      setReloading(true);
      await onReload();
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="w-70 border-l gap-2" style={{ height: "calc(100vh - 64px)" }}>
      <div className="h-full flex flex-col">
        <div className="p-3 border-b">
          <div className="font-semibold mb-2">Komentar</div>

          <div className="grid grid-cols-2 gap-2 mb-2 text-sm">
            <div>
              <label className="block text-xs text-gray-500">Section</label>
              <select
                className="w-full border rounded p-1"
                value={sectionId}
                onChange={onChangeSection}
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
              <input
                className="w-full border rounded p-1"
                value={getDisplayLabel(page) || ""}
                readOnly
              />
            </div>
          </div>

          <div className="mb-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-500">Komentar</label>
              <Button
                type="Button"
                onClick={toggle}
                disabled={!supported}
                title={
                  supported
                    ? "Gunakan suara (Ctrl+Shift+M)"
                    : "Browser tidak mendukung SpeechRecognition"
                }
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

          <div className="flex justify-between items-center mt-2">
            <Button className="px-3 py-1 bg-black text-white rounded-lg" onClick={submit}>
              Tambah
            </Button>
            <div className="flex gap-2">
              <Button className="px-3 py-1 border rounded-lg" onClick={onExport}>
                Export Excel
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm">Riwayat</div>
            {onReload && (
              <Button
                className="px-2 py-0.5 text-xs border rounded"
                onClick={handleReload}
                disabled={reloading}
              >
                {reloading ? "Reloading…" : "Reload"}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {[...comments]
              .sort((a, b) => new Date(b.createdAt || b.created_at || Date.now()) - new Date(a.createdAt || a.created_at || Date.now()))
              .map((c) => {
                const created = c.createdAt || c.created_at || Date.now();
                const userName = c.user?.name || c.user_name || c.name || "Unknown";
                const line =
                  (c.lineNo ?? c.line_no) != null ? (c.lineNo ?? c.line_no) : null;
                const sectionTitle =
                  c.sectionTitle || c.section?.title || c.section_title || "";

                return (
                  <div key={c.id} className="border rounded-lg p-2 text-sm">
                    <div className="text-[10px] text-gray-500 flex gap-2">
                      <span>{new Date(created).toLocaleString()}</span>
                      <span>• {userName}</span>
                      <span>
                        • Pg {c.page}
                        {line !== null ? `, Ln ${line}` : ""}
                      </span>
                    </div>

                    {sectionTitle && (
                      <div className="text-[10px] text-gray-600">Section: {sectionTitle}</div>
                    )}

                    <div className="mt-1">{c.body}</div>
                  </div>
                );
              })}
            {comments.length === 0 && (
              <div className="text-gray-500 text-sm">Belum ada komentar.</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
