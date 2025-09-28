import React from "react";

export default function PageInfoChip({ pageNumber }) {
  return (
    <div className="fixed z-40 top-20 right-8 px-2.5 py-1.5 text-xs rounded-lg border bg-white/90 backdrop-blur shadow pointer-events-none">
      <div className="flex items-center gap-1">
        <span className="font-medium">Page</span>
        <span>: <b>{pageNumber}</b></span>
      </div>
    </div>
  );
}
