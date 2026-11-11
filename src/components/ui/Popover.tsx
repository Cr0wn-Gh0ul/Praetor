"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type PopoverProps = {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
};

export function Popover({ label, trigger, triggerClassName = "", panelClassName = "w-80", align = "end", children }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button ref={triggerRef} type="button" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((current) => !current)} className={triggerClassName}>
        {trigger}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className={`popover absolute top-full z-50 mt-1.5 ${align === "end" ? "right-0" : "left-0"} ${panelClassName}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
