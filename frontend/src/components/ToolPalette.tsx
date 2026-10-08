import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { tools } from '@/data/tools';
import { useKeybinds } from '@/keybinds';
import { 
  MousePointerClick, 
  PenLine, 
  Box, 
  Home, 
  Edit3, 
  Ruler, 
  Layout, 
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Settings,
} from 'lucide-react';
import clsx from 'clsx';

export const ToolPalette: React.FC = () => {
  const { activeTool, setActiveTool, setCommandPaletteOpen } = useAppStore((state) => ({
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
    setCommandPaletteOpen: state.setCommandPaletteOpen,
  }));
  
  const { getShortcutLabel } = useKeybinds();
  const [collapsed, setCollapsed] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Select');
  
  const categories = [
    { id: 'Select', name: 'Selection', icon: MousePointerClick },
    { id: 'Sketch', name: 'Sketch', icon: PenLine },
    { id: 'Model', name: 'Model', icon: Box },
    { id: 'Architecture', name: 'Architecture', icon: Home },
    { id: 'Modify', name: 'Modify', icon: Edit3 },
    { id: 'Annotate', name: 'Annotate', icon: BarChart3 },
    { id: 'View', name: 'View', icon: Layout },
    { id: 'Measure', name: 'Measure', icon: Ruler },
  ];
  
  const handleToolClick = (toolId: string) => {
    setActiveTool(toolId === activeTool ? null : toolId);
  };
  
  const handleToggleCollapse = () => {
    setCollapsed(!collapsed);
  };
  
  if (collapsed) {
    return (
      <div className="w-12 bg-toolbar border-r border-border flex flex-col items-center py-2">
        <button
          className="p-2 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all mb-2"
          onClick={handleToggleCollapse}
          title="Expand Tool Palette"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className={clsx(
                'p-2 rounded-lg transition-all mb-1',
                activeCategory === cat.id 
                  ? 'bg-accent/10 text-accent' 
                  : 'text-fg-muted hover:text-fg hover:bg-panel-hover'
              )}
              onClick={() => setActiveCategory(cat.id)}
              title={cat.name}
            >
              <Icon className="w-5 h-5" />
            </button>
          );
        })}
        <button
          className="p-2 text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all mt-auto mb-2"
          onClick={() => setCommandPaletteOpen(true)}
          title="Command Palette (Ctrl+P)"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>
    );
  }
  
  return (
    <div className="w-56 bg-panel border-r border-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-border">
        <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">
          {categories.find((c) => c.id === activeCategory)?.name || 'Tools'}
        </span>
        <button
          className="p-1 text-fg-muted hover:text-fg hover:bg-panel-hover rounded transition-all"
          onClick={handleToggleCollapse}
          title="Collapse Tool Palette"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      
      {/* Category Tabs */}
      <div className="flex overflow-x-auto scrollbar-thin bg-bg-secondary/50 border-b border-border">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              className={clsx(
                'flex items-center justify-center flex-1 min-w-[60px] py-2 text-xs transition-all border-b-2',
                activeCategory === cat.id
                  ? 'text-accent border-accent bg-panel'
                  : 'text-fg-muted border-transparent hover:text-fg hover:bg-panel-hover'
              )}
              onClick={() => setActiveCategory(cat.id)}
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
      
      {/* Tools Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-3 gap-1.5">
          {tools.filter((t) => t.category === activeCategory).map((tool) => (
            <button
              key={tool.id}
              className={clsx(
                'relative group flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-xl transition-all',
                'hover:bg-panel-hover hover:text-fg',
                {
                  'bg-accent/10 text-accent border border-accent shadow-lg': activeTool === tool.id,
                  'text-fg-muted': activeTool !== tool.id,
                }
              )}
              onClick={() => handleToolClick(tool.id)}
            >
              <span className="text-2xl">{tool.icon}</span>
              <span className="text-xs font-medium leading-tight">{tool.name}</span>
              {tool.shortcut && (
                <span className="absolute -top-1 -right-1 text-[8px] bg-bg-tertiary text-fg-muted px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  {getShortcutLabel(tool.shortcut)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      
      {/* Quick Access */}
      <div className="p-2 border-t border-border">
        <button
          className="w-full flex items-center justify-center gap-2 py-1.5 text-sm text-fg-muted hover:text-fg hover:bg-panel-hover rounded-lg transition-all"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Settings className="w-4 h-4" />
          Command Palette
        </button>
      </div>
    </div>
  );
};