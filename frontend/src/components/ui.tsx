import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import {
  useEffect,
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
    "inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const variants = {
    default: "bg-base-300 text-base-800 hover:bg-base-400",
    ghost: "bg-transparent text-base-700 hover:bg-base-300",
    primary: "bg-accent-600 text-white hover:bg-accent-700",
    danger: "bg-red-900/60 text-red-100 hover:bg-red-800/70",
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
}: {
  icon: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-base-600 transition-colors hover:bg-base-300 hover:text-base-800 disabled:opacity-30 disabled:pointer-events-none",
        active && "bg-accent-600 text-white hover:bg-accent-700",
        className,
      )}
    >
      {icon}
    </button>
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
        "w-full min-w-0 rounded-md border border-base-400 bg-base-100 px-2 py-1 text-[12.5px] text-base-800 outline-none focus:border-accent-600",
        mono && "font-mono text-[12px]",
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
}: {
  value: number;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  className?: string;
  step?: number;
}) {
  const num = Number.isFinite(value) ? formatNum(value) : "";
  return (
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
        if (Number.isFinite(parsed)) onCommit?.(parsed);
        else e.target.value = formatNum(value);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          const parsed = parseFloat(e.currentTarget.value);
          if (Number.isFinite(parsed)) onCommit?.(parsed);
        }
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      data-step={step}
      className={cn(
        "w-full min-w-0 rounded-md border border-base-400 bg-base-100 px-2 py-1 text-right font-mono text-[12px] text-base-800 outline-none focus:border-accent-600",
        className,
      )}
    />
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
        "w-full rounded-md border border-base-400 bg-base-100 px-2 py-1 text-[12.5px] text-base-800 outline-none focus:border-accent-600",
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
        "flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-base-700 hover:text-base-800",
        className,
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-sm border border-base-500 bg-base-100 checked:border-accent-600 checked:bg-accent-600"
      />
      {label && <span>{label}</span>}
    </label>
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
      className={cn("h-7 w-10 cursor-pointer rounded border border-base-400 bg-base-100", className)}
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
    <div className={cn("flex h-full flex-col overflow-hidden bg-base-100", className)}>
      {title && (
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-base-300 bg-base-150 px-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-base-600">
            {title}
          </span>
          <div className="flex items-center gap-0.5">{actions}</div>
        </div>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto p-2", bodyClassName)}>{children}</div>
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-2xl",
          width,
        )}
      >
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300 px-3">
          <span className="text-[13px] font-medium text-base-800">{title}</span>
          <IconButton icon={<X size={14} />} onClick={onClose} title="Close" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-center gap-2 py-1">
      <span className="text-right text-[12px] text-base-600">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
