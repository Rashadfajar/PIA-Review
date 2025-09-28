import React from "react";
import Button from "./ui/Button";

export default function SectionList({ sections, onJump, activeId, getDisplayLabel }) {
  return (
    <div className="w-56 border-r overflow-auto p-2" style={{ height: "calc(100vh - 64px)" }}>
      <div className="font-semibold mb-2">Sections</div>
      {sections.map((s) => (
        <Button
          key={s.id}
          className={`block w-full text-left px-2 py-1 rounded-lg hover:bg-gray-50 ${activeId === s.id ? "bg-gray-100" : ""}`}
          onClick={() => onJump(s)}
          title={s.title}
        >
          {"\u00A0".repeat(2 * Math.max(0, (s.level || 1) - 1))}
          {s.title}
          <span className="text-[11px] text-gray-500 ml-1">[{getDisplayLabel(s.page)}]</span>
        </Button>
      ))}
      {sections.length === 0 && (
        <div className="text-gray-500 text-sm">(Tidak ada outline; menggunakan deteksi heading fallback)</div>
      )}
    </div>
  );
}
