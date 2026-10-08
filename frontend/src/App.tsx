import React, { useEffect, useCallback, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import Viewport from '@/components/Viewport';
import Toolbar from '@/components/Toolbar';
import StatusBar from '@/components/StatusBar';
import ToolPalette from '@/components/ToolPalette';
import QuickAccessToolbar from '@/components/QuickAccessToolbar';
import PropertyPanel from '@/components/PropertyPanel';
import LayerPanel from '@/components/LayerPanel';
import ProjectPanel from '@/components/ProjectPanel';
import CommandPalette from '@/components/CommandPalette';
import NavigationCube from '@/components/NavigationCube';
import SnapIndicator from '@/components/SnapIndicator';
import FloatingActionBar from '@/components/FloatingActionBar';
import { registerTools } from '@/data';
import { useKeyboardShortcuts, useTheme } from '@/hooks';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import './App.css';

export function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const { 
    settings, 
    documents, 
    activeDocumentId,
    statusMessage,
    commandPaletteOpen,
    preferencesOpen,
    helpOpen,
  } = useAppStore((state) => ({
    settings: state.settings,
    documents: state.documents,
    activeDocumentId: state.activeDocumentId,
    statusMessage: state.statusMessage,
    commandPaletteOpen: state.commandPaletteOpen,
    preferencesOpen: state.preferencesOpen,
    helpOpen: state.helpOpen,
  }));
  
  useKeyboardShortcuts();
  const { theme } = useTheme();
  
  useEffect(() => {
    initializeApp();
  }, []);
  
  const initializeApp = async () => {
    try {
      await registerTools(useAppStore);
      
      const savedSettings = await invoke('get_settings');
      useAppStore.getState().setSettings(savedSettings as any);
      
      const docs = await invoke('get_documents');
      useAppStore.getState().setDocuments(docs as any);
      
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to initialize app:', err);
      setIsLoading(false);
    }
  };
  
  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner">Loading Arc...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="error-screen">
        <h2>Error: {error}</h2>
      </div>
    );
  }
  
  return (
    <div className={`app ${theme}`} data-theme={theme}>
      <QuickAccessToolbar />
      
      <div className="main-layout">
        <ProjectPanel />
        
        <div className="editor-area">
          <Toolbar />
          <ToolPalette />
          
          <div className="viewport-container">
            <Viewport />
            <NavigationCube />
            <SnapIndicator />
            <FloatingActionBar />
          </div>
          
          <StatusBar />
        </div>
        
        <PropertyPanel />
        <LayerPanel />
      </div>
      
      {commandPaletteOpen && <CommandPalette />}
      
      <div className="status-toast">
        {statusMessage && (
          <div className={`status-message ${statusMessage.severity || 'info'}`}>
            {statusMessage.text}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;