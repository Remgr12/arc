import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  File, 
  Save, 
  Download, 
  Upload, 
  Copy, 
  Scissors, 
  ClipboardPaste,
  Undo2,
  Redo2,
  Printer,
  Share2,
  Trash2,
  Folder,
  Plus,
  Search,
  Settings,
  HelpCircle,
  Info,
  Menu,
  Bell,
  User,
  Shield,
  Package,
  LayoutGrid,
  Maximize,
  Minimize,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import clsx from 'clsx';

export const QuickAccessToolbar: React.FC = () => {
  const { 
    canUndo, 
    canRedo,
    isDirty,
    setActiveTool,
    setCommandPaletteOpen,
  } = useAppStore((state) => ({
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    isDirty: state.isDirty,
    setActiveTool: state.setActiveTool,
    setCommandPaletteOpen: state.setCommandPaletteOpen,
  }));
  
  const [showNewMenu, setShowNewMenu] = useState(false);
  const newMenuRef = useRef<HTMLDivElement>(null);
  
  const handleUndo = () => useAppStore.getState().undo();
  const handleRedo = () => useAppStore.getState().redo();
  const handleNew = () => {
    useAppStore.getState().createDocument('Untitled');
    setActiveTool('select');
  };
  const handleSave = () => {
    useAppStore.getState().setStatusMessage('Saving...', 3000);
  };
  
  const handleOpen = () => {
    useAppStore.getState().setStatusMessage('Opening file...', 3000);
  };
  
  const handleDownload = () => {
    useAppStore.getState().setStatusMessage('Exporting...', 3000);
  };
  
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (newMenuRef.current && !newMenuRef.current.contains(e.target as Node)) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);
  
  return (
    <div className="h-10 bg-toolbar border-b border-border flex items-center px-2 gap-1 overflow-x-auto">
      {/* New Document Menu */}
      <div className="relative" ref={newMenuRef}>
        <button
          className={clsx(
            'flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg transition-all',
            'hover:bg-panel-hover hover:text-fg',
            isDirty ? 'text-accent' : 'text-fg-muted'
          )}
          onClick={() => setShowNewMenu(true)}
          title="New Document"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New</span>
        </button>
        
        {showNewMenu && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-panel border border-border rounded-lg shadow-modal z-50">
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-panel-hover rounded-t-lg">
              <File className="w-4 h-4" />
              New Document
            </button>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-panel-hover">
              <LayoutGrid className="w-4 h-4" />
              New from Template
            </button>
            <button className="w-full flex items-center gap-2 px-3 py-2 text-sm text-fg hover:bg-panel-hover rounded-b-lg">
              <Package className="w-4 h-4" />
              New Project
            </button>
          </div>
        )}
      </div>
      
      {/* Open */}
      <button
        className="flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg text-fg-muted hover:text-fg hover:bg-panel-hover transition-all"
        onClick={handleOpen}
        title="Open (Ctrl+O)"
      >
        <Folder className="w-4 h-4" />
        <span className="hidden sm:inline">Open</span>
      </button>
      
      {/* Save */}
      <button
        className={clsx(
          'flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg transition-all',
          isDirty ? 'text-accent hover:bg-accent/10' : 'text-fg-muted hover:text-fg hover:bg-panel-hover'
        )}
        onClick={handleSave}
        title="Save (Ctrl+S)"
      >
        <Save className="w-4 h-4" />
        <span className="hidden sm:inline">Save</span>
      </button>
      
      <div className="w-px h-5 bg-border mx-1"></div>
      
      {/* Undo/Redo */}
      <button
        className={clsx(
          'px-2 py-1.5 rounded-lg transition-all',
          canUndo ? 'text-fg hover:bg-panel-hover' : 'text-fg-muted cursor-not-allowed'
        )}
        onClick={handleUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        className={clsx(
          'px-2 py-1.5 rounded-lg transition-all',
          canRedo ? 'text-fg hover:bg-panel-hover' : 'text-fg-muted cursor-not-allowed'
        )}
        onClick={handleRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        <Redo2 className="w-4 h-4" />
      </button>
      
      <div className="w-px h-5 bg-border mx-1"></div>
      
      {/* Edit */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Cut (Ctrl+X)"
      >
        <Scissors className="w-4 h-4" />
      </button>
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Copy (Ctrl+C)"
      >
        <Copy className="w-4 h-4" />
      </button>
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Paste (Ctrl+V)"
      >
        <ClipboardPaste className="w-4 h-4" />
      </button>
      
      <div className="w-px h-5 bg-border mx-1"></div>
      
      {/* Export */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Export"
        onClick={handleDownload}
      >
        <Download className="w-4 h-4" />
      </button>
      
      {/* Import */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Import"
      >
        <Upload className="w-4 h-4" />
      </button>
      
      <div className="w-px h-5 bg-border mx-1"></div>
      
      {/* Command Palette */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Command Palette (Ctrl+P)"
        onClick={() => setCommandPaletteOpen(true)}
      >
        <Search className="w-4 h-4" />
      </button>
      
      {/* Settings */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
      </button>
      
      {/* Help */}
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Help"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
    </div>
  );
};