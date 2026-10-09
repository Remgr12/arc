import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  Target, 
  Grid3x3, 
  MousePointerClick, 
  Hash, 
  Circle, 
  Layout,
  Divide,
  ExternalLink,
  Square,
} from 'lucide-react';
import clsx from 'clsx';

export const SnapIndicator: React.FC = () => {
  const { mousePosition, modifiers, settings, snapEnabled } = useAppStore((state) => ({
    mousePosition: state.mousePosition,
    modifiers: state.modifiers,
    settings: state.settings,
    snapEnabled: state.settings.snapEnabled,
  }));
  
  const [visible, setVisible] = useState(false);
  const [snapMode, setSnapMode] = useState<string | null>(null);
  const [fadeTimeout, setFadeTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  
  useEffect(() => {
    if (snapEnabled) {
      setVisible(true);
      if (fadeTimeout) clearTimeout(fadeTimeout);
      const timeout = setTimeout(() => {
        setVisible(false);
      }, 2000);
      setFadeTimeout(timeout);
    }
    
    return () => {
      if (fadeTimeout) clearTimeout(fadeTimeout);
    };
  }, [mousePosition, snapEnabled, fadeTimeout]);
  
  const getSnapIcon = (mode: string | null) => {
    if (!snapEnabled) return <MousePointerClick className="w-4 h-4 text-fg-muted" />;
    
    switch (mode) {
      case 'endpoint': return <MousePointerClick className="w-4 h-4" />;
      case 'midpoint': return <Target className="w-4 h-4" />;
      case 'center': return <Circle className="w-4 h-4" />;
      case 'intersection': return <Divide className="w-4 h-4" />;
      case 'grid': return <Grid3x3 className="w-4 h-4" />;
      case 'perpendicular': return <Layout className="w-4 h-4" />;
      case 'tangent': return <ExternalLink className="w-4 h-4" />;
      case 'nearest': return <Hash className="w-4 h-4" />;
      case 'quadrant': return <Square className="w-4 h-4" />;
      default: return <MousePointerClick className="w-4 h-4" />;
    }
  };
  
  const getSnapLabel = () => {
    if (!snapEnabled) return 'Snap: OFF';
    
    switch (snapMode) {
      case 'endpoint': return 'Endpoint';
      case 'midpoint': return 'Midpoint';
      case 'center': return 'Center';
      case 'intersection': return 'Intersection';
      case 'grid': return 'Grid';
      case 'perpendicular': return 'Perpendicular';
      case 'tangent': return 'Tangent';
      case 'nearest': return 'Nearest';
      case 'quadrant': return 'Quadrant';
      default: return 'Snap: ON';
    }
  };
  
  const getModKeys = () => {
    const mods: string[] = [];
    if (modifiers.shift) mods.push('Shift');
    if (modifiers.ctrl) mods.push('Ctrl');
    if (modifiers.alt) mods.push('Alt');
    return mods.join(' + ');
  };
  
  return (
    <div
      className={clsx(
        'absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg shadow-panel transition-all duration-200',
        'flex items-center gap-2 text-sm',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none',
        snapEnabled 
          ? 'bg-accent/10 text-accent border border-accent' 
          : 'bg-panel text-fg-muted border border-border'
      )}
    >
      {getSnapIcon(snapMode)}
      <span className="font-medium">{getSnapLabel()}</span>
      
      {modifiers.shift && (
        <>
          <div className="w-px h-3 bg-border"></div>
          <kbd className="px-1.5 py-0.25 text-xs bg-bg-tertiary rounded">Shift</kbd>
        </>
      )}
      
      {modifiers.ctrl && (
        <>
          <div className="w-px h-3 bg-border"></div>
          <kbd className="px-1.5 py-0.25 text-xs bg-bg-tertiary rounded">Ctrl</kbd>
        </>
      )}
      
      {modifiers.alt && (
        <>
          <div className="w-px h-3 bg-border"></div>
          <kbd className="px-1.5 py-0.25 text-xs bg-bg-tertiary rounded">Alt</kbd>
        </>
      )}
    </div>
  );
};