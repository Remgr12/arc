import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Tool } from '@/types';
import { tools } from '@/data/tools';
import { useKeybinds } from '@/keybinds';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import clsx from 'clsx';

export const Toolbar: React.FC = () => {
  const { activeTool, setActiveTool } = useAppStore((state) => ({
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
  }));
  
  const { getShortcutLabel } = useKeybinds();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  
  const toolGroups = [
    { id: 'Select', name: 'Selection', tools: tools.filter((t) => t.category === 'Select') },
    { id: 'Sketch', name: 'Sketch', tools: tools.filter((t) => t.category === 'Sketch') },
    { id: 'Model', name: 'Model', tools: tools.filter((t) => t.category === 'Model') },
    { id: 'Architecture', name: 'Architecture', tools: tools.filter((t) => t.category === 'Architecture') },
    { id: 'Modify', name: 'Modify', tools: tools.filter((t) => t.category === 'Modify') },
    { id: 'Annotate', name: 'Annotate', tools: tools.filter((t) => t.category === 'Annotate') },
    { id: 'View', name: 'View', tools: tools.filter((t) => t.category === 'View') },
    { id: 'Measure', name: 'Measure', tools: tools.filter((t) => t.category === 'Measure') },
  ];
  
  const handleToolClick = (toolId: string) => {
    setActiveTool(toolId === activeTool ? null : toolId);
  };
  
  const toggleGroup = (groupId: string) => {
    setExpandedGroup(expandedGroup === groupId ? null : groupId);
  };
  
  return (
    <div className="toolbar flex flex-col h-full overflow-y-auto">
      {toolGroups.map((group) => {
        if (group.tools.length === 0) return null;
        
        const isExpanded = expandedGroup === group.id || (expandedGroup === null && group.id === 'Select');
        const groupTools = isExpanded ? group.tools : group.tools.slice(0, 4);
        const hasOverflow = group.tools.length > 4;
        
        return (
          <div key={group.id} className="border-b border-border">
            <div 
              className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-panel-hover transition-colors"
              onClick={() => toggleGroup(group.id)}
            >
              <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">
                {group.name}
              </span>
              {hasOverflow && (
                isExpanded ? 
                  <ChevronDown className="w-3 h-3 text-fg-muted" /> :
                  <ChevronRight className="w-3 h-3 text-fg-muted" />
              )}
            </div>
            
            <div className="flex flex-col gap-1 p-1">
              {groupTools.map((tool) => (
                <button
                  key={tool.id}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-left',
                    'hover:bg-panel-hover hover:text-fg',
                    {
                      'bg-accent/10 text-accent border border-accent': activeTool === tool.id,
                      'text-fg-muted': activeTool !== tool.id,
                    }
                  )}
                  onClick={() => handleToolClick(tool.id)}
                >
                  <span className="text-xl">{tool.icon}</span>
                  <span className="flex-1 text-sm font-medium">{tool.name}</span>
                  {tool.shortcut && (
                    <span className="text-xs text-fg-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
                      {getShortcutLabel(tool.shortcut)}
                    </span>
                  )}
                </button>
              ))}
              
              {hasOverflow && !isExpanded && (
                <button
                  className="flex items-center justify-center px-3 py-1.5 rounded-lg text-sm text-fg-muted hover:bg-panel-hover transition-colors"
                  onClick={() => toggleGroup(group.id)}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};