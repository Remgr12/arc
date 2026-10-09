import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores/appStore';
import { commands } from '@/data/commands';
import { useKeybinds } from '@/keybinds';
import { 
  Search, 
  ChevronRight, 
  Clock, 
  FileText,
  Copy,
  Trash2,
  RotateCw,
  FlipHorizontal,
  Move,
  Scale,
  Maximize2,
  Scissors,
  Package,
  Settings,
  FolderOpen,
  FileDown,
  FileUp,
  Share2,
  Shield,
  Users,
  BarChart3,
} from 'lucide-react';
import clsx from 'clsx';

export const CommandPalette: React.FC = () => {
  const { 
    commandPaletteOpen, 
    setCommandPaletteOpen, 
    setActiveTool,
    setStatusMessage,
    executeCommand,
  } = useAppStore((state) => ({
    commandPaletteOpen: state.commandPaletteOpen,
    setCommandPaletteOpen: state.setCommandPaletteOpen,
    setActiveTool: state.setActiveTool,
    setStatusMessage: state.setStatusMessage,
    executeCommand: state.executeCommand,
  }));
  
  const { getShortcutLabel } = useKeybinds();
  
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  
  const filteredCommands = useMemo(() => {
    if (!query) {
      return commands.slice(0, 12);
    }
    
    const queryLower = query.toLowerCase();
    return commands.filter((cmd) => 
      cmd.name.toLowerCase().includes(queryLower) ||
      cmd.category.toLowerCase().includes(queryLower) ||
      cmd.id.toLowerCase().includes(queryLower)
    );
  }, [query]);
  
  const groupedCommands = useMemo(() => {
    const groups: Record<string, typeof commands> = {};
    filteredCommands.forEach((cmd) => {
      const category = cmd.category || 'Other';
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(cmd);
    });
    return groups;
  }, [filteredCommands]);
  
  const getCommandIcon = (cmdId: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      'new-document': <FileText className="w-4 h-4" />,
      'open': <FolderOpen className="w-4 h-4" />,
      'save': <Copy className="w-4 h-4" />,
      'save-as': <Copy className="w-4 h-4" />,
      'export': <FileDown className="w-4 h-4" />,
      'import': <FileUp className="w-4 h-4" />,
      'undo': <RotateCw className="w-4 h-4" />,
      'redo': <RotateCw className="w-4 h-4" />,
      'cut': <Scissors className="w-4 h-4" />,
      'copy': <Copy className="w-4 h-4" />,
      'paste': <Copy className="w-4 h-4" />,
      'delete': <Trash2 className="w-4 h-4" />,
      'duplicate': <Copy className="w-4 h-4" />,
      'group': <Package className="w-4 h-4" />,
      'ungroup': <Package className="w-4 h-4" />,
      'move': <Move className="w-4 h-4" />,
      'rotate': <RotateCw className="w-4 h-4" />,
      'scale': <Maximize2 className="w-4 h-4" />,
      'mirror': <FlipHorizontal className="w-4 h-4" />,
      'settings': <Settings className="w-4 h-4" />,
      'help': <FileText className="w-4 h-4" />,
      'measure': <BarChart3 className="w-4 h-4" />,
    };
    return iconMap[cmdId] || <FileText className="w-4 h-4" />;
  };
  
  const handleCommand = useCallback(async (cmdId: string) => {
    const cmd = commands.find((c) => c.id === cmdId);
    if (!cmd) return;
    
    setCommandPaletteOpen(false);
    
    try {
      await useAppStore.getState().executeCommand(cmd.action || cmdId);
      setRecentCommands((prev) => {
        const filtered = prev.filter((id) => id !== cmdId);
        return [cmdId, ...filtered].slice(0, 10);
      });
      setStatusMessage(`${cmd.name} executed`, 2000);
    } catch (error) {
      setStatusMessage(`Error: ${error}`, 3000);
    }
  }, [setCommandPaletteOpen, setStatusMessage]);
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setCommandPaletteOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleCommand(filteredCommands[selectedIndex]?.id || '');
    }
  };
  
  const handleCommandClick = (cmdId: string) => {
    setSelectedIndex(0);
    setQuery('');
    handleCommand(cmdId);
  };
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(0);
  };
  
  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [commandPaletteOpen]);
  
  if (!commandPaletteOpen) return null;
  
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]">
      <div className="bg-panel border border-border rounded-xl shadow-modal w-[600px] max-h-[70vh] flex flex-col">
        {/* Search */}
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
            <input
              ref={inputRef}
              type="text"
              className="input pl-10 pr-4 py-2.5 text-sm"
              placeholder="Type a command..."
              value={query}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
            />
          </div>
        </div>
        
        {/* Results */}
        <div className="overflow-y-auto max-h-[50vh]">
          {query === '' && recentCommands.length > 0 && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-fg-muted" />
                <span className="text-xs font-medium text-fg-muted uppercase">
                  Recent Commands
                </span>
              </div>
              {recentCommands.map((cmdId, idx) => {
                const cmd = commands.find((c) => c.id === cmdId);
                if (!cmd) return null;
                return (
                  <button
                    key={cmdId}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-all',
                      'hover:bg-panel-hover hover:text-fg',
                      'text-fg-muted'
                    )}
                    onClick={() => handleCommandClick(cmdId)}
                  >
                    {getCommandIcon(cmdId)}
                    <span className="flex-1 text-sm">{cmd.name}</span>
                    {cmd.shortcut && (
                      <kbd className="text-xs text-fg-muted bg-bg-tertiary px-1.5 py-0.5 rounded">
                        {getShortcutLabel(cmd.shortcut)}
                      </kbd>
                    )}
                  </button>
                );
              })}
              <div className="h-px bg-border my-2"></div>
            </div>
          )}
          
          {filteredCommands.length === 0 && query && (
            <div className="px-4 py-8 text-center text-fg-muted">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No commands found</p>
            </div>
          )}
          
          {Object.entries(groupedCommands).map(([category, catCommands]) => (
            <div key={category}>
              {catCommands.length > 0 && (
                <div className="px-3 py-1">
                  <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">
                    {category}
                  </span>
                </div>
              )}
              {catCommands.map((cmd, idx) => {
                const globalIndex = filteredCommands.indexOf(cmd);
                const isSelected = globalIndex === selectedIndex;
                
                return (
                  <button
                    key={cmd.id}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2 text-left transition-all',
                      isSelected 
                        ? 'bg-accent/10 text-accent' 
                        : 'text-fg-muted hover:bg-panel-hover hover:text-fg'
                    )}
                    onClick={() => handleCommandClick(cmd.id)}
                  >
                    <div className="w-5 h-5 flex items-center justify-center">
                      {getCommandIcon(cmd.id)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{cmd.name}</span>
                        {cmd.category && (
                          <span className="text-xs text-fg-muted bg-bg-tertiary px-1.5 py-0.25 rounded">
                            {cmd.category}
                          </span>
                        )}
                      </div>
                      {cmd.description && (
                        <p className="text-xs text-fg-muted mt-0.5">
                          {cmd.description}
                        </p>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <kbd className="text-xs text-fg-muted bg-bg-secondary px-1.5 py-0.5 rounded">
                        {getShortcutLabel(cmd.shortcut)}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};