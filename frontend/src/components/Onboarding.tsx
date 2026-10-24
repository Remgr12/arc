import { useState } from "react";
import { FolderOpen, Check } from "lucide-react";
import { Button, TextField, cn } from "./ui";
import { Logo } from "./Logo";
import { useArcStore } from "../lib/store";
import { commitWorkspaceFolder } from "../lib/workspace";
import { BUILTIN_THEMES, useThemeStore } from "../lib/themes";
import type { Theme } from "../lib/themes";
import { useKeybindStore } from "../lib/keybindProfiles";

const STEP_LABELS = ["Workspace", "Theme", "Keybinds"] as const;

export function Onboarding() {
  const open = useArcStore((s) => s.onboardingOpen);
  const [step, setStep] = useState(0);
  const [folder, setFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const skip = () => {
    useArcStore.getState().setOnboardingOpen(false);
  };

  const browse = async () => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const picked = await openDialog({
      title: "Choose a projects folder",
      directory: true,
    });
    if (typeof picked === "string" && picked.length > 0) {
      setFolder(picked);
      setFolderError(null);
    }
  };

  const next = async () => {
    if (step === 0) {
      const clean = folder.trim();
      if (!clean) {
        setFolderError("Choose a folder to store your projects in.");
        return;
      }
      setBusy(true);
      try {
        await commitWorkspaceFolder(clean);
        setFolderError(null);
        setStep(1);
      } catch (error) {
        setFolderError(String(error));
      }
      setBusy(false);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    // Workspace is committed; land on the dashboard behind the modal.
    useArcStore.getState().setOnboardingOpen(false);
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-base-50">
      <div className="flex w-[620px] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-base-300 px-6 py-5">
          <Logo size={34} />
          <div className="flex flex-col">
            <span className="text-[18px] font-semibold text-base-800">
              Welcome to arc
            </span>
            <span className="text-[12px] text-base-600">
              Three quick steps to set up your workspace
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-6 pt-4">
          {STEP_LABELS.map((label, index) => (
            <div key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (index < step) setStep(index);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] transition-colors",
                  index === step
                    ? "bg-accent-600/15 text-accent-600"
                    : index < step
                      ? "text-base-700 hover:bg-base-200"
                      : "text-base-500",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full border text-[10px]",
                    index < step
                      ? "border-accent-600 bg-accent-600 text-white"
                      : index === step
                        ? "border-accent-600"
                        : "border-base-500",
                  )}
                >
                  {index < step ? <Check size={10} /> : index + 1}
                </span>
                {label}
              </button>
              {index < STEP_LABELS.length - 1 && (
                <span className="h-px w-6 bg-base-300" />
              )}
            </div>
          ))}
        </div>
        <div className="min-h-[220px] px-6 py-5">
          {step === 0 && (
            <FolderStep
              folder={folder}
              setFolder={setFolder}
              folderError={folderError}
              browse={browse}
              busy={busy}
            />
          )}
          {step === 1 && <ThemeStep />}
          {step === 2 && <KeybindStep />}
        </div>
        <div className="flex items-center justify-between border-t border-base-300 px-6 py-3">
          <Button variant="ghost" onClick={skip} disabled={busy}>
            Skip for now
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={back} disabled={step === 0 || busy}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void next()} disabled={busy}>
              {step === 2 ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FolderStep({
  folder,
  setFolder,
  folderError,
  browse,
  busy,
}: {
  folder: string;
  setFolder: (value: string) => void;
  folderError: string | null;
  browse: () => Promise<void>;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-base-700">
        Where should arc store your projects? Files you save and create will
        live in this folder.
      </p>
      <div className="flex gap-2">
        <TextField
          value={folder}
          onChange={setFolder}
          placeholder="/home/me/projects"
          mono
        />
        <Button onClick={() => void browse()} disabled={busy}>
          <FolderOpen size={14} /> Browse…
        </Button>
      </div>
      {folderError && (
        <span className="text-[11.5px] text-red-400">{folderError}</span>
      )}
    </div>
  );
}

function ThemeStep() {
  const activeId = useThemeStore((s) => s.activeId);
  const setActive = useThemeStore((s) => s.setActive);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-base-700">
        Pick a color theme. You can create custom themes later in Settings.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {BUILTIN_THEMES.map((theme) => (
          <ThemeCard
            key={theme.id}
            name={theme.name}
            colors={theme.colors}
            active={activeId === theme.id}
            onSelect={() => setActive(theme.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({
  name,
  colors,
  active,
  onSelect,
}: {
  name: string;
  colors: Theme["colors"];
  active: boolean;
  onSelect: () => void;
}) {
  const chips = [
    colors["base-100"],
    colors["viewport-bg"],
    colors["viewport-grid"],
    colors["accent-600"],
  ];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col gap-2 rounded-lg border bg-base-150 p-2.5 text-left transition-colors",
        active
          ? "border-accent-600 ring-1 ring-accent-600"
          : "border-base-300 hover:border-base-400",
      )}
    >
      <div className="flex gap-1">
        {chips.map((color, index) => (
          <span
            key={`${name}-${index}`}
            className="h-5 w-5 rounded-md border border-black/20"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
      <span className="text-[12px] text-base-800">{name}</span>
    </button>
  );
}

function KeybindStep() {
  const profiles = useKeybindStore((s) => s.profiles);
  const activeId = useKeybindStore((s) => s.activeId);
  const setActive = useKeybindStore((s) => s.setActive);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-base-700">
        Choose a keyboard layout. You can edit and create profiles in Settings
        at any time.
      </p>
      <div className="flex flex-col gap-1.5">
        {profiles.map((profile) => (          <button
            key={profile.id}
            type="button"
            onClick={() => setActive(profile.id)}
            className={cn(
              "flex items-center justify-between rounded-md border px-3 py-2 text-[12.5px] transition-colors",
              activeId === profile.id
                ? "border-accent-600 bg-accent-600/10 text-accent-600"
                : "border-base-300 bg-base-150 text-base-700 hover:border-base-400",
            )}
          >
            <span className="font-medium">{profile.name}</span>
            <span className="text-[11px] text-base-500">
              {profile.builtin
                ? "built-in default"
                : `${Object.keys(profile.bindings).length} bindings`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}