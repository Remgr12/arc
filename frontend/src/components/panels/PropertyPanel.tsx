import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import clsx from 'clsx';

export const PropertyPanel: React.FC = () => {
  const { selection, activeTool, hoverEntity } = useAppStore((state) => ({
    selection: state.selection,
    activeTool: state.activeTool,
    hoverEntity: state.hoverEntity,
  }));
  
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'transform': true,
    'properties': true,
    'view': true,
  });
  
  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };
  
  const renderTransformProperties = () => {
    const entity = selection.selectedIds.length > 0 
      ? useAppStore.getState().documents
          .find((d) => d.id.uuid === useAppStore.getState().activeDocumentId)
          ?.entities
          .find((e) => selection.selectedIds.some((id) => id.uuid === e.id.uuid))
      : hoverEntity;
    
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] font-medium text-fg-muted uppercase">X</label>
            <input
              type="number"
              className="input text-sm"
              placeholder="0.000"
              defaultValue={entity?.transform?.translation.x ?? 0}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-fg-muted uppercase">Y</label>
            <input
              type="number"
              className="input text-sm"
              placeholder="0.000"
              defaultValue={entity?.transform?.translation.y ?? 0}
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-fg-muted uppercase">Z</label>
            <input
              type="number"
              className="input text-sm"
              placeholder="0.000"
              defaultValue={entity?.transform?.translation.z ?? 0}
            />
          </div>
        </div>
      </div>
    );
  };
  
  const renderProperties = () => {
    const doc = useAppStore.getState().documents.find((d) => d.id.uuid === useAppStore.getState().activeDocumentId);
    const entity = selection.selectedIds.length > 0
      ? doc?.entities.find((e) => selection.selectedIds.some((id) => id.uuid === e.id.uuid))
      : hoverEntity;
    
    if (!entity) return null;
    
    return (
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Name</label>
          <input
            type="text"
            className="input text-sm"
            defaultValue={entity.name}
            placeholder="Entity name"
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Type</label>
          <p className="text-sm text-fg">{entity.type}</p>
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-fg-muted">Visible</label>
          <input
            type="checkbox"
            className="checkbox"
            defaultChecked={entity.visible}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-fg-muted">Locked</label>
          <input
            type="checkbox"
            className="checkbox"
            defaultChecked={entity.locked}
          />
        </div>
        
        <div>
          <label className="block text-xs font-medium text-fg-muted mb-1">Layer</label>
          <select className="input text-sm">
            <option value="">No Layer</option>
          </select>
        </div>
      </div>
    );
  };
  
  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border">
        <div className="px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Properties</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            {selection.selectedIds.length > 0
              ? `${selection.selectedIds.length} selected`
              : 'No selection'}
          </p>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Transform */}
        <div className="border-b border-border">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-panel-hover transition-colors"
            onClick={() => toggleSection('transform')}
          >
            <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">Transform</span>
            {expandedSections.transform ? (
              <ChevronDown className="w-4 h-4 text-fg-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-fg-muted" />
            )}
          </button>
          {expandedSections.transform && (
            <div className="px-4 py-3">
              {renderTransformProperties()}
            </div>
          )}
        </div>
        
        {/* Properties */}
        <div className="border-b border-border">
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-panel-hover transition-colors"
            onClick={() => toggleSection('properties')}
          >
            <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">Entity Properties</span>
            {expandedSections.properties ? (
              <ChevronDown className="w-4 h-4 text-fg-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-fg-muted" />
            )}
          </button>
          {expandedSections.properties && (
            <div className="px-4 py-3">
              {renderProperties()}
            </div>
          )}
        </div>
        
        {/* View */}
        <div>
          <button
            className="w-full flex items-center justify-between px-4 py-2 text-left hover:bg-panel-hover transition-colors"
            onClick={() => toggleSection('view')}
          >
            <span className="text-xs font-medium text-fg-muted uppercase tracking-wider">View Options</span>
            {expandedSections.view ? (
              <ChevronDown className="w-4 h-4 text-fg-muted" />
            ) : (
              <ChevronRight className="w-4 h-4 text-fg-muted" />
            )}
          </button>
          {expandedSections.view && (
            <div className="px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-fg-muted">Show Edges</label>
                <input type="checkbox" className="checkbox" defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-fg-muted">Show Vertices</label>
                <input type="checkbox" className="checkbox" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-fg-muted">Backface Culling</label>
                <input type="checkbox" className="checkbox" defaultChecked />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};