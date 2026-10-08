import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  Check, 
  X, 
  Move, 
  RotateCw, 
  Expand, 
  Copy,
  Trash2,
  Save,
} from 'lucide-react';
import clsx from 'clsx';

export const FloatingActionBar: React.FC = () => {
  const { activeTool, selection, mousePosition, modifiers } = useAppStore((state) => ({
    activeTool: state.activeTool,
    selection: state.selection,
    mousePosition: state.mousePosition,
    modifiers: state.modifiers,
  }));
  
  const [visible, setVisible] = useState(true);
  const barRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        const target = e.target as Element;
        if (!target.closest('[data-floating-bar]')) {
          setVisible(false);
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  const getToolName = (): string => {
    const toolNames: Record<string, string> = {
      select: 'Select',
      'sketch-line': 'Line',
      'sketch-circle': 'Circle',
      'sketch-arc': 'Arc',
      'sketch-rectangle': 'Rectangle',
      'sketch-polyline': 'Polyline',
      'sketch-spline': 'Spline',
      'model-extrude': 'Extrude',
      'model-revolve': 'Revolve',
      'model-fillet': 'Fillet',
      'model-chamfer': 'Chamfer',
      'modify-move': 'Move',
      'modify-rotate': 'Rotate',
      'modify-scale': 'Scale',
      'arch-wall': 'Wall',
      'arch-door': 'Door',
      'arch-window': 'Window',
      'arch-stair': 'Stair',
      'arch-column': 'Column',
      'arch-beam': 'Beam',
      'arch-slab': 'Slab',
      'arch-roof': 'Roof',
      'arch-room': 'Room',
      'dimension': 'Dimension',
    };
    return toolNames[activeTool ?? ''] || activeTool || 'Select';
  };
  
  if (!visible || !activeTool || activeTool === 'select') return null;
  
  return (
    <div
      ref={barRef}
      data-floating-bar="true"
      className="absolute top-1/4 left-1/2 -translate-x-1/2 bg-panel border border-border rounded-xl shadow-panel flex items-center gap-1 p-1"
      style={{
        top: mousePosition.y > 400 ? 160 : 'auto',
        bottom: mousePosition.y <= 400 ? 160 : 'auto',
        transform: mousePosition.x > 600 
          ? 'translateX(-50%)' 
          : 'translateX(50%)',
        left: mousePosition.x > 600 ? 'auto' : 'auto',
        right: mousePosition.x > 600 ? 24 : 'auto',
      }}
    >
      <div className="px-3 py-1.5 border-r border-border">
        <span className="text-sm font-medium text-fg">{getToolName()}</span>
      </div>
      
      <button
        className="p-1.5 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
        title="Commit"
        onClick={() => {
          useAppStore.getState().setStatusMessage('Operation confirmed', 2000);
          setVisible(false);
        }}
      >
        <Check className="w-4 h-4" />
      </button>
      
      <button
        className="p-1.5 text-fg-muted hover:text-error hover:bg-error/10 rounded-lg transition-all"
        title="Cancel (Esc)"
        onClick={() => {
          useAppStore.getState().setActiveTool(null);
          setVisible(false);
        }}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};