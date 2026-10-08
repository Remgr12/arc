import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  Undo2, 
  Redo2, 
  Save, 
  Copy, 
  ClipboardPaste, 
  Scissors, 
  Printer,
  Download,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  Copy as CopyIcon,
  Navigation,
  Grid3x3,
  Magnet,
  MousePointer,
  Settings,
  HelpCircle,
  Info,
} from 'lucide-react';
import clsx from 'clsx';

export const StatusBar: React.FC = () => {
  const { 
    statusMessage, 
    canUndo, 
    canRedo, 
    settings,
    mousePosition,
    modifiers,
    snapEnabled,
    orthoMode,
    activeTool,
    layers,
    activeLayerId,
    setSettings,
    undo,
    redo,
  } = useAppStore((state) => ({
    statusMessage: state.statusMessage,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    settings: state.settings,
    mousePosition: state.mousePosition,
    modifiers: state.modifiers,
    snapEnabled: state.settings.snapEnabled,
    orthoMode: state.settings.orthoMode,
    activeTool: state.activeTool,
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    setSettings: state.setSettings,
    undo: state.undo,
    redo: state.redo,
  }));
  
  const activeLayer = layers.find((l) => l.id.uuid === activeLayerId);
  const [showFullCoords, setShowFullCoords] = useState(false);
  
  const handleUndo = () => {
    if (canUndo) undo();
  };
  
  const handleRedo = () => {
    if (canRedo) redo();
  };
  
  const toggleSnap = () => {
    setSettings({ snapEnabled: !snapEnabled });
  };
  
  const toggleOrtho = () => {
    setSettings({ orthoMode: !orthoMode });
  };
  
  const getCurrentCoords = (): string => {
    if (showFullCoords) {
      return `X: ${mousePosition.x.toFixed(2)}, Y: ${mousePosition.y.toFixed(2)}`;
    }
    return `X: ${Math.round(mousePosition.x)}, Y: ${Math.round(mousePosition.y)}`;
  };
  
  const getModString = (): string => {
    const mods: string[] = [];
    if (modifiers.shift) mods.push('Shift');
    if (modifiers.ctrl) mods.push('Ctrl');
    if (modifiers.alt) mods.push('Alt');
    if (modifiers.meta) mods.push('Cmd');
    return mods.join(' + ') || '-';
  };
  
  const getToolName = (): string => {
    if (!activeTool) return 'Select';
    const tool = useAppStore.getState().tools[activeTool];
    return tool?.name || activeTool;
  };
  
  return (
    <div className="status-bar h-6 px-2 text-xs">
      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          className={clsx('p-0.5 rounded hover:bg-panel-hover transition-colors', {
            'text-accent': canUndo,
            'text-fg-muted': !canUndo,
          })}
          onClick={handleUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          className={clsx('p-0.5 rounded hover:bg-panel-hover transition-colors', {
            'text-accent': canRedo,
            'text-fg-muted': !canRedo,
          })}
          onClick={handleRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>
      
      <div className="h-4 w-px bg-border mx-2"></div>
      
      {/* Status Message */}
      {statusMessage && (
        <>
          <span className="text-fg-muted">{statusMessage}</span>
          <div className="h-4 w-px bg-border mx-2"></div>
        </>
      )}
      
      {/* Coordinates */}
      <button
        className="hover:text-fg text-fg-muted transition-colors"
        onClick={() => setShowFullCoords(!showFullCoords)}
        title="Toggle coordinate precision"
      >
        {getCurrentCoords()}
      </button>
      
      <div className="h-4 w-px bg-border mx-2"></div>
      
      {/* Modifiers */}
      <span className="text-fg-muted">
        {getModString()}
      </span>
      
      <div className="h-4 w-px bg-border mx-2"></div>
      
      {/* Active Tool */}
      <span className="text-fg-muted">
        Tool: <span className="text-fg">{getToolName()}</span>
      </span>
      
      <div className="h-4 w-px bg-border mx-2"></div>
      
      {/* Active Layer */}
      {activeLayer && (
        <>
          <span className="text-fg-muted">
            Layer: <span className="text-fg font-medium">{activeLayer.name}</span>
          </span>
          <div className="h-4 w-px bg-border mx-2"></div>
        </>
      )}
      
      {/* Status Indicators */}
      <div className="flex items-center gap-2 ml-auto">
        <button
          className={clsx(
            'p-0.5 rounded hover:bg-panel-hover transition-colors',
            snapEnabled ? 'text-accent' : 'text-fg-muted'
          )}
          onClick={toggleSnap}
          title="Toggle Snap (S)"
        >
          <Magnet className="w-3.5 h-3.5" />
        </button>
        
        <button
          className={clsx(
            'p-0.5 rounded hover:bg-panel-hover transition-colors',
            orthoMode ? 'text-accent' : 'text-fg-muted'
          )}
          onClick={toggleOrtho}
          title="Toggle Ortho Mode (O)"
        >
          <MousePointer className="w-3.5 h-3.5" />
        </button>
        
        {settings.showGrid && (
          <>
            <Grid3x3 className="w-3.5 h-3.5 text-fg-muted" title="Grid visible" />
          </>
        )}
        
        <div className="h-4 w-px bg-border mx-2"></div>
        
        <span className="text-fg-muted">
          Units: {settings.units.length}
        </span>
        
        <button
          className="p-0.5 rounded hover:bg-panel-hover text-fg-muted hover:text-fg transition-colors"
          title="Help"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};