import React from "react";
import Button from "./ui/Button";

function normalizeTitle(text = "") {
  // hapus spasi di kiri/kanan + rapikan spasi ganda jadi satu
  return String(text).replace(/\s+/g, " ").trim();
}

function truncate(text = "", max = 60) {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

export default function SectionList({ sections, onJump, activeId, getDisplayLabel }) {
  // Sanitize + filter: lewati judul kosong setelah di-trim
  const cleanSections = (sections || []).filter((s) => {
    const t = normalizeTitle(s.title);
    return t.length > 0;
  });

  return (
    <div className="w-56 border-r overflow-auto p-2" style={{ height: "calc(100vh - 64px)" }}>
      <div className="font-semibold mb-2">Sections</div>

      {cleanSections.map((s) => {
        const lvl = Math.max(0, (s.level || 1) - 1);
        const title = normalizeTitle(s.title);
        const pageLabel = getDisplayLabel?.(s.page) || "";
        const fullLabel = pageLabel ? `${title} [${pageLabel}]` : title;

        return (
          <Button
            key={s.id}
            onClick={() => onJump(s)}
            title={fullLabel} // tooltip full
            className={`block w-full text-left rounded-lg hover:bg-gray-50 ${
              activeId === s.id ? "bg-gray-100" : ""
            } px-2 py-0.5`}
          >
            <div className="flex items-center min-w-0 h-8 leading-none">
              {/* indent stabil */}
              <span className="shrink-0" style={{ width: 10 * lvl }} aria-hidden="true" />
              {/* satu baris + ellipsis */}
              <span className="truncate whitespace-nowrap text-sm">
                {truncate(fullLabel, 60)}
              </span>
            </div>
          </Button>
        );
      })}

      {cleanSections.length === 0 && (
        <div className="text-gray-500 text-sm">
          (Tidak ada outline; menggunakan deteksi heading fallback)
        </div>
      )}
    </div>
  );
}
