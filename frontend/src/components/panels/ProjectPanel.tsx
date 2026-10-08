import React, { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { 
  ChevronDown, 
  ChevronRight, 
  FileText, 
  Folder, 
  FolderOpen, 
  Plus,
  Search,
  Filter,
  SortAsc,
  SortDesc,
  MoreVertical,
  Edit2,
  Copy,
  Trash2,
  Share2,
  Database,
  Box,
  Layers,
} from 'lucide-react';
import clsx from 'clsx';

export const ProjectPanel: React.FC = () => {
  const { documents, activeDocumentId, setActiveDocument, setActiveTool } = useAppStore((state) => ({
    documents: state.documents,
    activeDocumentId: state.activeDocumentId,
    setActiveDocument: state.setActiveDocument,
    setActiveTool: state.setActiveTool,
  }));
  
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['root']));
  
  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  
  const activeDocument = documents.find((d) => d.id.uuid === activeDocumentId);
  
  const getDocumentIcon = (doc: any) => {
    if (doc.modified) return <FileText className="w-4 h-4 text-accent" />;
    return <FileText className="w-4 h-4 text-fg-muted" />;
  };
  
  const getEntityTypeIcon = (type: string) => {
    switch (type) {
      case 'Wall':
      case 'Door':
      case 'Window':
      case 'Stair':
      case 'Roof':
      case 'Slab':
      case 'Column':
      case 'Beam':
      case 'Room':
        return <Layers className="w-4 h-4 text-blue-500" />;
      case 'Extrusion':
      case 'Revolution':
      case 'Loft':
      case 'Sweep':
        return <Box className="w-4 h-4 text-green-500" />;
      case 'Line':
      case 'Polyline':
        return <ChevronRight className="w-4 h-4 text-orange-500" />;
      default:
        return <Database className="w-4 h-4 text-fg-muted" />;
    }
  };
  
  const getTypeName = (type: string) => {
    switch (type) {
      case 'Wall': return 'Walls';
      case 'Door': return 'Doors';
      case 'Window': return 'Windows';
      case 'Stair': return 'Stairs';
      case 'Roof': return 'Roofs';
      case 'Slab': return 'Slabs';
      case 'Column': return 'Columns';
      case 'Beam': return 'Beams';
      case 'Room': return 'Rooms';
      default: return type + 's';
    }
  };
  
  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border">
        <div className="px-4 py-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">Project Browser</h2>
          <div className="flex gap-1">
            <button
              className="p-1 text-fg-muted hover:text-fg hover:bg-panel-hover rounded transition-all"
              title="Search"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              className="p-1 text-fg-muted hover:text-fg hover:bg-panel-hover rounded transition-all"
              title="Filter"
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-muted" />
            <input
              type="text"
              className="input pl-8 text-sm"
              placeholder="Search in project..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="tree-view">
          {documents.map((doc) => {
            const docId = `doc-${doc.id.uuid}`;
            const isExpanded = expandedNodes.has(docId);
            const isActive = doc.id.uuid === activeDocumentId;
            
            return (
              <div key={doc.id.uuid}>
                <div
                  className={clsx(
                    'flex items-center gap-1 px-3 py-1.5 cursor-pointer transition-all',
                    isActive 
                      ? 'bg-accent/10 text-accent border-l-2 border-accent' 
                      : 'hover:bg-panel-hover text-fg-muted'
                  )}
                  onClick={() => setActiveDocument(doc.id.uuid)}
                >
                  <button
                    className="p-0.5 hover:bg-panel-hover rounded transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleNode(docId);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>
                  
                  {getDocumentIcon(doc)}
                  
                  <span className="text-sm font-medium flex-1 truncate">
                    {doc.name}
                  </span>
                  
                  {doc.modified && (
                    <span className="w-2 h-2 bg-accent rounded-full" title="Modified" />
                  )}
                </div>
                
                {isExpanded && (
                  <div className="ml-4 pl-2 border-l border-border">
                    {doc.layers.map((layer) => (
                      <div key={layer.id.uuid}>
                        <div
                          className="flex items-center gap-1 px-2 py-1 hover:bg-panel-hover rounded cursor-pointer"
                          title={layer.name}
                        >
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{
                              backgroundColor: layer.color ? `rgb(${Math.round(layer.color.r * 255)}, ${Math.round(layer.color.g * 255)}, ${Math.round(layer.color.b * 255)})` : '#888',
                            }}
                          />
                          <span className="text-xs text-fg-muted">{layer.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {documents.length === 0 && (
          <div className="px-4 py-8 text-center text-fg-muted">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No open documents</p>
            <button
              className="mt-2 text-sm text-accent hover:underline"
              onClick={() => {
                const { useAppStore } = require('@/stores/appStore');
                useAppStore.getState().createDocument('Untitled');
              }}
            >
              Create new document
            </button>
          </div>
        )}
      </div>
    </div>
  );
};