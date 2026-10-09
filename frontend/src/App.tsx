import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Viewport } from '@/components/Viewport';
import { Toolbar } from '@/components/Toolbar';
import { StatusBar } from '@/components/StatusBar';
import { ToolPalette } from '@/components/ToolPalette';
import { QuickAccessToolbar } from '@/components/QuickAccessToolbar';
import { PropertyPanel } from '@/components/panels/PropertyPanel';
import { LayerPanel } from '@/components/panels/LayerPanel';
import { ProjectPanel } from '@/components/panels/ProjectPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { NavigationCube } from '@/components/NavigationCube';
import { SnapIndicator } from '@/components/SnapIndicator';
import { FloatingActionBar } from '@/components/FloatingActionBar';
import { registerTools } from '@/data';
import { useKeyboardShortcuts, useTheme } from '@/hooks';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

export function App() {
  const [isLoading, setIsLoading] = useState(true);
  
  const { 
    commandPaletteOpen,
    statusMessage,
  } = useAppStore((state) => ({
    commandPaletteOpen: state.commandPaletteOpen,
    statusMessage: state.statusMessage,
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
          <div className="status-message info">
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;