import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
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
    "inline-flex h-8.5 items-center justify-center gap-2 rounded-lg px-3.5 text-[12px] font-medium transition-all duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";
  const variants = {
    default:
      "bg-base-200 text-base-700 border border-base-300 hover:bg-base-300 hover:text-base-800 shadow-sm",
    ghost: "bg-transparent text-base-600 hover:bg-base-200 hover:text-base-800",
    primary: "bg-accent-500 text-white hover:bg-accent-600 shadow-sm hover:shadow",
    danger: "bg-danger-500 text-white hover:bg-danger-600 shadow-sm hover:shadow",
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
  const dim = size === "sm" ? "h-7.5 w-7.5" : "h-8.5 w-8.5";
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded-lg text-base-600 transition-all duration-150 hover:bg-base-200 hover:text-base-800 active:scale-[0.95] disabled:pointer-events-none disabled:opacity-30",
        dim,
        active && "bg-accent-500/12 text-accent-600",
        className,
      )}
    >
      {icon}
    </button>
  );
}

export function Tip({
  children,
}: {
  label?: string;
  keys?: string;
  side?: "top" | "bottom" | "right" | "left";
  children: ReactNode;
  className?: string;
}) {
  return <>{children}</>;
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
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      value={draft}
      spellCheck={false}
      placeholder={placeholder}
      onFocus={() => {
        focusedRef.current = true;
        uiCapture.active = true;
      }}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        setDraft(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        uiCapture.active = false;
        onCommit?.(e.target.value);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
          onCommit?.(e.currentTarget.value);
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-base-300 bg-base-100 px-3 text-[12px] text-base-800 outline-none transition-all placeholder:text-base-500 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20",
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
  const clamp = (n: number) => {
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  const formatted = Number.isFinite(value) ? formatNum(value) : "";
  const [draft, setDraft] = useState(formatted);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(Number.isFinite(value) ? formatNum(value) : "");
    }
  }, [value]);

  const commitDraft = (raw: string) => {
    const parsed = parseFloat(raw);
    if (Number.isFinite(parsed)) {
      const next = clamp(parsed);
      setDraft(formatNum(next));
      onCommit?.(next);
    } else {
      setDraft(Number.isFinite(value) ? formatNum(value) : "");
    }
  };

  return (
    <div className="relative min-w-0">
      <input
        type="text"
        value={draft}
        spellCheck={false}
        onFocus={(e) => {
          focusedRef.current = true;
          uiCapture.active = true;
          e.currentTarget.select();
        }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const raw = e.target.value;
          setDraft(raw);
          const parsed = parseFloat(raw);
          if (raw !== "" && Number.isFinite(parsed)) {
            onChange?.(clamp(parsed));
          }
        }}
        onBlur={(e) => {
          focusedRef.current = false;
          uiCapture.active = false;
          commitDraft(e.target.value);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            commitDraft(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(Number.isFinite(value) ? formatNum(value) : "");
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 0.1 : 1);
            const current = parseFloat(draft);
            const base = Number.isFinite(current) ? current : value;
            const next = clamp(Math.round((base + delta) * 1000) / 1000);
            setDraft(formatNum(next));
            onChange?.(next);
            onCommit?.(next);
          }
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        data-step={step}
        className={cn(
          "h-8 w-full min-w-0 rounded-lg border border-base-300 bg-base-100 px-3 text-right font-mono text-[12px] text-base-800 outline-none transition-all focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20",
          className,
        )}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-base-500">
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
        "h-8 w-full rounded-lg border border-base-300 bg-base-100 px-3 text-[12px] text-base-800 outline-none transition-all focus:border-accent-500 focus:ring-2 focus:ring-accent-500/20",
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
    <div className={cn("flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-base-200 bg-base-50", className)}>
      {title && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-200 bg-base-100 px-3">
          <span className="text-[12px] font-semibold text-base-800">{title}</span>
          <div className="flex items-center gap-1.5">{actions}</div>
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
      className="anim-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "anim-pop flex max-h-[82vh] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl",
          width,
        )}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-base-200 px-4">
          <span className="text-[13px] font-semibold text-base-900">{title}</span>
          <IconButton icon={<X size={16} />} onClick={onClose} title="Close" size="sm" className="hover:bg-base-200" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2.5 py-1.5">
      <span title={label} className="truncate text-[11.5px] font-medium text-base-700">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-base-200/70", className)} />;
}
