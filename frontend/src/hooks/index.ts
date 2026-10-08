import { useAppStore } from '@/stores/appStore';
import { useEffect, useCallback } from 'react';
import { useKeybinds } from '@/keybinds';

export const useKeyboardShortcuts = () => {
  const { keysPressed, modifiers, setKeyPressed, setModifiers } = useAppStore((state) => ({
    keysPressed: state.keysPressed,
    modifiers: state.modifiers,
    setKeyPressed: state.setKeyPressed,
    setModifiers: state.setModifiers,
  }));
  
  const { matchesShortcut, getShortcut } = useKeybinds();
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    setKeyPressed(e.key, true);
    setModifiers({
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
    
    // Check for keybind matches
    const activeTool = useAppStore.getState().activeTool;
    
    if (e.repeat) return;
    
    if (e.key === 'Escape') {
      useAppStore.getState().setActiveTool(null);
      useAppStore.getState().setCommandPaletteOpen(false);
    }
    
    if (e.key === 'F1') {
      e.preventDefault();
      useAppStore.getState().setStatusMessage('Help: Press Ctrl+P for command palette', 3000);
    }
  }, [setKeyPressed, setModifiers]);
  
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    setKeyPressed(e.key, false);
    setModifiers({
      shift: e.shiftKey,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
  }, [setKeyPressed, setModifiers]);
  
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);
  
  return { keysPressed, modifiers };
};

export const useTauriAPI = () => {
  const invoke = async (command: string, args?: any) => {
    try {
      const { invoke: tauriInvoke } = await import('@tauri-apps/api/tauri');
      return await tauriInvoke(command, args);
    } catch (error) {
      console.error(`Failed to invoke ${command}:`, error);
      throw error;
    }
  };
  
  return { invoke };
};

export const useTheme = () => {
  const { settings, setTheme } = useAppStore((state) => ({
    settings: state.settings,
    setTheme: state.setTheme,
  }));
  
  const toggleTheme = useCallback(() => {
    const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  }, [settings.theme, setTheme]);
  
  const applyTheme = useCallback((theme: string) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
  }, []);
  
  useEffect(() => {
    applyTheme(settings.theme);
  }, [settings.theme, applyTheme]);
  
  return {
    theme: settings.theme,
    toggleTheme,
    applyTheme,
  };
};

export const useViewportControls = () => {
  const { 
    activeViewport, 
    setActiveViewport,
    cameras,
    setViewportCamera,
    layout,
    setViewportLayout,
    settings,
  } = useAppStore((state) => ({
    activeViewport: state.activeViewport,
    setActiveViewport: state.setActiveViewport,
    cameras: state.viewportCameras,
    setViewportCamera: state.setViewportCamera,
    layout: state.viewportLayout,
    setViewportLayout: state.setViewportLayout,
    settings: state.settings,
  }));
  
  const setView = useCallback((view: string) => {
    const camera = cameras[activeViewport];
    if (!camera) return;
    
    const newCamera = { ...camera };
    
    switch (view) {
      case 'top':
        newCamera.position = { x: 0, y: -100, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'bottom':
        newCamera.position = { x: 0, y: 100, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'front':
        newCamera.position = { x: 0, y: -100, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'back':
        newCamera.position = { x: 0, y: 100, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'left':
        newCamera.position = { x: -100, y: 0, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'right':
        newCamera.position = { x: 100, y: 0, z: 0 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
      case 'iso':
        newCamera.position = { x: 100, y: 100, z: 100 };
        newCamera.target = { x: 0, y: 0, z: 0 };
        newCamera.up = { x: 0, y: 0, z: 1 };
        break;
    }
    
    setViewportCamera(activeViewport, newCamera);
  }, [activeViewport, cameras, setViewportCamera]);
  
  const zoomExtents = useCallback(() => {
    setView('iso');
  }, [setView]);
  
  const setLayout = useCallback((newLayout: typeof layout) => {
    setViewportLayout(newLayout);
    useAppStore.getState().setStatusMessage(`Viewport layout: ${newLayout}`, 2000);
  }, [setViewportLayout]);
  
  return {
    activeViewport,
    setActiveViewport,
    layout,
    setLayout,
    camera: cameras[activeViewport],
    setView,
    zoomExtents,
  };
};