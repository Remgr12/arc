import React, { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  ChevronDown, 
  ChevronRight, 
  Plus, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock,
  Search,
  MoreVertical,
  Trash2,
  Edit2,
  Copy,
} from 'lucide-react';
import clsx from 'clsx';

export const LayerPanel: React.FC = () => {
  const { layers, activeLayerId, setActiveLayer, setLayers, settings } = useAppStore((state) => ({
    layers: state.layers,
    activeLayerId: state.activeLayerId,
    setActiveLayer: state.setActiveLayer,
    setLayers: state.setLayers,
    settings: state.settings,
  }));
  
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  const filteredLayers = layers.filter((layer) =>
    layer.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const toggleLayerVisibility = (id: string) => {
    const updatedLayers = layers.map((l) =>
      l.id.uuid === id ? { ...l, visible: !l.visible } : l
    );
    setLayers(updatedLayers);
  };
  
  const toggleLayerLock = (id: string) => {
    const updatedLayers = layers.map((l) =>
      l.id.uuid === id ? { ...l, locked: !l.locked } : l
    );
    setLayers(updatedLayers);
  };
  
  const handleLayerClick = (id: string) => {
    setActiveLayer(id);
  };
  
  const addNewLayer = () => {
    const newLayer = {
      id: { uuid: crypto.randomUUID() },
      name: `Layer ${layers.length + 1}`,
      visible: true,
      locked: false,
      color: { r: 1, g: 1, b: 1, a: 1 },
      lineWeight: 0.25,
      lineType: 'Continuous' as const,
      printable: true,
    };
    setLayers([...layers, newLayer]);
    setActiveLayer(newLayer.id.uuid);
  };
  
  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };
  
  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Layers</h2>
          <button
            className="p-1 text-fg-muted hover:text-fg hover:bg-panel-hover rounded transition-all"
            onClick={addNewLayer}
            title="Add Layer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
            <input
              type="text"
              className="input pl-8 text-sm"
              placeholder="Filter layers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {filteredLayers.map((layer) => {
          const isActive = layer.id.uuid === activeLayerId;
          const isDimmed = !layer.visible;
          
          return (
            <div
              key={layer.id.uuid}
              className={clsx(
                'group flex items-center gap-1 px-3 py-2 transition-all',
                isActive 
                  ? 'bg-accent/10 border-l-2 border-accent' 
                  : 'hover:bg-panel-hover'
              )}
            >
              <button
                className="w-4 h-4 rounded-full flex-shrink-0 transition-colors"
                style={{
                  backgroundColor: layer.color ? `rgb(${Math.round(layer.color.r * 255)}, ${Math.round(layer.color.g * 255)}, ${Math.round(layer.color.b * 255)})` : '#888',
                }}
                onClick={() => handleLayerClick(layer.id.uuid)}
                title={layer.name}
              />
              
              <div className="flex-1 min-w-0">
                <span className={clsx(
                  'text-sm font-medium',
                  isDimmed ? 'text-fg-muted line-through' : isActive ? 'text-accent' : 'text-fg'
                )}>
                  {layer.name}
                </span>
              </div>
              
              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                <button
                  className="p-1 text-fg-muted hover:text-fg rounded transition-all"
                  onClick={() => toggleLayerVisibility(layer.id.uuid)}
                  title={layer.visible ? 'Hide Layer' : 'Show Layer'}
                >
                  {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                
                <button
                  className="p-1 text-fg-muted hover:text-accent rounded transition-all"
                  onClick={() => toggleLayerLock(layer.id.uuid)}
                  title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
                >
                  {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>
                
                <button
                  className="p-1 text-fg-muted hover:text-error rounded transition-all"
                  title="Delete Layer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="p-2 border-t border-border bg-bg-secondary/30">
        <div className="flex gap-1 text-xs text-fg-muted">
          <span>
            {layers.filter((l) => l.visible).length} / {layers.length} visible
          </span>
        </div>
      </div>
    </div>
  );
};