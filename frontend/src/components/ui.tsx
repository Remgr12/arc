import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { uiCapture } from "../lib/uiCapture";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "default",
  className,
  title,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "ghost" | "primary" | "danger";
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  const base =
    "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
  const variants = {
    default:
      "bg-base-300 text-base-700 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] hover:bg-base-400 hover:text-base-800",
    ghost: "bg-transparent text-base-600 hover:bg-base-300 hover:text-base-800",
    primary: "bg-accent-600 text-white hover:bg-accent-500",
    danger: "bg-danger-600/80 text-white hover:bg-danger-600",
  };
  return (
    <button
      type={type ?? "button"}
      title={title}
      disabled={disabled}
      className={cn(base, variants[variant], className)}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  active,
  disabled,
  title,
  className,
  size = "md",
}: {
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "h-6 w-6" : "h-7 w-7";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-md text-base-600 transition-colors hover:bg-base-300 hover:text-base-800 disabled:pointer-events-none disabled:opacity-30",
        dim,
        active && "bg-accent-600 text-white hover:bg-accent-500",
        className,
      )}
    >
      {icon}
    </button>
  );
}

export function Tip({
  label,
  keys,
  side = "bottom",
  children,
  className,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom" | "right" | "left";
  children: ReactNode;
  className?: string;
}) {
  const pos = {
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  }[side];
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        className={cn(
          "pointer-events-none absolute z-[90] hidden items-center gap-1.5 whitespace-nowrap rounded-md border border-base-400 bg-base-150 px-2 py-1 text-[11px] font-medium text-base-700 shadow-lg shadow-black/40 group-hover/tip:flex",
          pos,
        )}
      >
        {label}
        {keys && <span className="font-mono text-[10px] text-base-500">{keys}</span>}
      </span>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-base-400 bg-base-200 px-1 font-mono text-[10px] text-base-600">
      {children}
    </span>
  );
}

export function TextField({
  value,
  onChange,
  onCommit,
  placeholder,
  className,
  mono,
}: {
  value: string;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
      onBlur={(e) => onCommit?.(e.target.value)}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") onCommit?.(e.currentTarget.value);
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "h-7 w-full min-w-0 rounded-md border border-base-400 bg-base-200 px-2 text-[12px] text-base-800 outline-none transition-colors placeholder:text-base-500 focus:border-accent-500",
        mono && "font-mono text-[11.5px]",
        className,
      )}
    />
  );
}

export function NumField({
  value,
  onChange,
  onCommit,
  className,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const dragRef = useRef<{ y: number; v: number } | null>(null);
  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  const num = Number.isFinite(value) ? formatNum(value) : "";
  return (
    <div className="relative min-w-0">
      <input
        type="text"
        value={num}
        spellCheck={false}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const parsed = parseFloat(e.target.value);
          if (e.target.value === "") return;
          if (Number.isFinite(parsed)) onChange?.(parsed);
        }}
        onBlur={(e) => {
          const parsed = parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onCommit?.(clamp(parsed));
          else e.target.value = formatNum(value);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            const parsed = parseFloat(e.currentTarget.value);
            if (Number.isFinite(parsed)) onCommit?.(clamp(parsed));
          }
          if (e.key === "Escape") e.currentTarget.blur();
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button !== 0) return;
          dragRef.current = { y: e.clientY, v: value };
          const move = (ev: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const fine = ev.shiftKey ? 0.2 : 1;
            const delta = (drag.y - ev.clientY) * step * fine * 0.25;
            const next = clamp(drag.v + delta);
            dragRef.current = { y: ev.clientY, v: next };
            onChange?.(next);
          };
          const up = () => {
            const drag = dragRef.current;
            dragRef.current = null;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (drag && drag.v !== value) onCommit?.(drag.v);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onFocus={(e) => e.currentTarget.select()}
        data-step={step}
        className={cn(
          "h-7 w-full min-w-0 cursor-ew-resize rounded-md border border-base-400 bg-base-200 px-2 text-right font-mono text-[11.5px] text-base-800 outline-none transition-colors focus:cursor-text focus:border-accent-500",
          className,
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-base-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

function formatNum(n: number): string {
  const r = Math.round(n * 1000) / 1000;
  return String(r);
}

export function SelectField({
  value,
  options,
  onChange,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 w-full rounded-md border border-base-400 bg-base-200 px-1.5 text-[12px] text-base-800 outline-none transition-colors focus:border-accent-500",
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-md border border-base-400 bg-base-200 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
            value === o.value
              ? "bg-base-400 text-base-800"
              : "text-base-600 hover:text-base-700",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 text-[12px] text-base-600 hover:text-base-700",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-[3px] border border-base-500 bg-base-200 transition-colors checked:border-accent-500 checked:bg-accent-600 checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 6.2 5.2 8.4 9 4.4%22 fill=%22none%22 stroke=%22white%22 stroke-width=%221.6%22 stroke-linecap=%22round%22/></svg>')] checked:bg-center checked:bg-no-repeat checked:bg-[length:10px]"
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[16px] w-[28px] shrink-0 rounded-full border transition-colors",
        checked ? "border-accent-500 bg-accent-600" : "border-base-500 bg-base-300",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 h-[10px] w-[10px] -translate-y-1/2 rounded-full bg-white transition-all",
          checked ? "left-[14px]" : "left-[3px] bg-base-600",
        )}
      />
    </button>
  );
}

export function ColorField({
  color,
  onChange,
  className,
}: {
  color: [number, number, number, number];
  onChange: (color: [number, number, number, number]) => void;
  className?: string;
}) {
  const css = `#${toHex(color[0])}${toHex(color[1])}${toHex(color[2])}${color[3] < 0.999 ? toHex(color[3]) : ""}`;
  return (
    <input
      type="color"
      value={css.slice(0, 7)}
      onChange={(e) => {
        const hex = e.target.value;
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        onChange([r, g, b, color[3]]);
      }}
      className={cn("h-6 w-9 cursor-pointer rounded-md border border-base-400 bg-base-200", className)}
    />
  );
}

function toHex(v: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(v * 255)));
  return clamped.toString(16).padStart(2, "0");
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden", className)}>
      {title && (
        <div className="flex h-8 shrink-0 items-center justify-between px-3">
          <span className="text-[11px] font-medium text-base-600">{title}</span>
          <div className="flex items-center gap-0.5">{actions}</div>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = "w-[560px]",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (uiCapture.active) return; // capture fields own Escape while active
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 pt-[14vh] backdrop-blur-[2px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex max-h-[72vh] flex-col overflow-hidden rounded-xl border border-base-400 bg-base-100 shadow-[0_24px_70px_-12px_rgba(0,0,0,0.65)]",
          width,
        )}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-300 px-3.5">
          <span className="text-[13px] font-medium text-base-800">{title}</span>
          <IconButton icon={<X size={14} />} onClick={onClose} title="Close" size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3.5">{children}</div>
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-0.5">
      <span className="truncate text-[11px] text-base-600">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-base-300/70", className)} />;
}
