import React from "react";

export default function Button({ children, className = "", ...props }) {
  return (
    <button
      className={`cursor-pointer transition-all duration-200 hover:opacity-90 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
