import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ViewportCamera, RaycastHit } from '@/types';
import { invoke } from '@tauri-apps/api/core';
import { useKeybinds } from '@/keybinds';

export const Viewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  
  const { 
    activeViewport, 
    setActiveViewport, 
    setViewportCamera, 
    viewportLayout,
    settings,
    activeTool,
    setMousePosition,
    setMouseButton,
    modifiers,
    setModifiers,
    selection,
    setSelection,
    setStatusMessage,
  } = useAppStore((state) => ({
    activeViewport: state.activeViewport,
    setActiveViewport: state.setActiveViewport,
    setViewportCamera: state.setViewportCamera,
    viewportLayout: state.viewportLayout,
    settings: state.settings,
    activeTool: state.activeTool,
    setMousePosition: state.setMousePosition,
    setMouseButton: state.setMouseButton,
    modifiers: state.modifiers,
    setModifiers: state.setModifiers,
    selection: state.selection,
    setSelection: state.setSelection,
    setStatusMessage: state.setStatusMessage,
  }));
  
  const { matchesShortcut } = useKeybinds();
  const [camera, setCamera] = useState<ViewportCamera>({
    position: { x: 100, y: 100, z: 100 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    fov: 45,
    near: 0.1,
    far: 100000,
    aspectRatio: 1.777,
    projection: 'perspective',
  });
  
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const updateCanvasSize = () => {
      const displayWidth = canvas.clientWidth;
      const displayHeight = canvas.clientHeight;
      
      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        setCamera((c) => ({ ...c, aspectRatio: displayWidth / displayHeight }));
      }
    };
    
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, []);
  
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const gl = canvas.getContext('2d');
    if (!gl) return;
    
    // Clear canvas
    gl.fillStyle = settings.viewportBackground;
    gl.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid
    if (settings.showGrid) {
      drawGrid(gl, camera, settings.gridSize, settings.gridSubdivisions);
    }
    
    // Draw axes
    if (settings.showAxes) {
      drawAxes(gl, camera);
    }
    
    animationFrameRef.current = requestAnimationFrame(render);
  }, [settings, camera]);
  
  const drawGrid = (gl: CanvasRenderingContext2D, camera: ViewportCamera, size: number, subdivisions: number) => {
    if (camera.projection === 'orthographic') {
      const gridSize = 1000;
      const step = 100;
      
      gl.strokeStyle = 'rgba(100, 100, 100, 0.1)';
      gl.lineWidth = 1;
      
      for (let i = -gridSize; i <= gridSize; i += step) {
        gl.beginPath();
        gl.moveTo(i + camera.target.x, -gridSize);
        gl.lineTo(i + camera.target.x, gridSize);
        gl.moveTo(-gridSize, i + camera.target.y);
        gl.lineTo(gridSize, i + camera.target.y);
        gl.stroke();
      }
    }
  };
  
  const drawAxes = (gl: CanvasRenderingContext2D, camera: ViewportCamera) => {
    const centerX = camera.target.x;
    const centerY = camera.target.y;
    
    gl.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    gl.lineWidth = 2;
    gl.beginPath();
    gl.moveTo(centerX, centerY);
    gl.lineTo(centerX + 50, centerY);
    gl.stroke();
    
    gl.strokeStyle = 'rgba(0, 255, 0, 0.8)';
    gl.beginPath();
    gl.moveTo(centerX, centerY);
    gl.lineTo(centerX, centerY + 50);
    gl.stroke();
  };
  
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    
    setMousePosition({ x, y });
    setMouseButton('left', true);
    
    // Determine if this is a selection or viewport action
    const isNavModifier = modifiers.alt;
    const isSelectModifier = modifiers.ctrl;
    const addToSelection = modifiers.shift;
    
    if (isNavModifier) {
      // Viewport navigation
      return;
    }
    
    // Raycast on click
    const raycast = async () => {
      try {
        const result: RaycastHit | null = await invoke('raycast', {
          viewportIndex: 0,
          screenX: x,
          screenY: y,
        });
        
        if (result?.entityId) {
          const entityId = result.entityId;
          if (addToSelection) {
            const newIds = selection.selectedIds.some((id) => id.uuid === entityId.uuid)
              ? selection.selectedIds.filter((id) => id.uuid !== entityId.uuid)
              : [...selection.selectedIds, entityId];
            setSelection({ ...selection, selectedIds: newIds, primaryId: entityId });
          } else {
            setSelection({ selectedIds: [entityId], primaryId: entityId });
          }
        } else {
          setSelection({ selectedIds: [], primaryId: undefined });
        }
      } catch (error) {
        console.error('Raycast error:', error);
      }
    };
    
    raycast();
  }, [setMousePosition, setMouseButton, modifiers, selection, setSelection]);
  
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    
    setMousePosition({ x, y });
  }, [setMousePosition]);
  
  useEffect(() => {
    const cleanup = initCanvas();
    animationFrameRef.current = requestAnimationFrame(render);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      cleanup?.();
    };
  }, [initCanvas, render]);
  
  const getViewClass = () => {
    switch (viewportLayout) {
      case 'single':
        return 'absolute inset-0';
      case 'horizontal-split':
        return 'absolute top-1/2 left-0 right-0 bottom-0';
      case 'vertical-split':
        return 'absolute left-1/2 top-0 bottom-0 right-0';
      case 'quad':
        return 'absolute top-0 left-0 right-0 bottom-0';
      default:
        return 'absolute inset-0';
    }
  };
  
  return (
    <canvas
      ref={canvasRef}
      className="viewport"
      style={{ 
        background: settings.viewportBackground,
        cursor: settings.orthoMode ? 'crosshair' : 
               activeTool && activeTool !== 'select' ? 'crosshair' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => setMouseButton('left', false)}
      onMouseLeave={() => {
        setMouseButton('left', false);
        setMouseButton('right', false);
        setMouseButton('middle', false);
      }}
      onWheel={(e) => {
        e.preventDefault();
        const zoomFactor = 1 - e.deltaY * 0.001;
        setCamera((c) => ({
          ...c,
          position: {
            x: c.target.x + (c.position.x - c.target.x) * zoomFactor,
            y: c.target.y + (c.position.y - c.target.y) * zoomFactor,
            z: c.target.z + (c.position.z - c.target.z) * zoomFactor,
          },
        }));
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
};

export default Viewport;