import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export const NavigationCube: React.FC = () => {
  const cubeRef = useRef<HTMLDivElement>(null);
  const [hoveredFace, setHoveredFace] = useState<string | null>(null);
  const { setViewportCamera, activeViewport } = useAppStore((state) => ({
    setViewportCamera: state.setViewportCamera,
    activeViewport: state.activeViewport,
  }));
  
  const setView = useCallback((view: string) => {
    // Send view change command to backend
    const camera = useAppStore.getState().cameras[activeViewport];
    if (camera) {
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
    }
  }, [setViewportCamera, activeViewport]);
  
  const faces: { name: string; label: string; normal: [number, number, number]; icon: React.ReactNode }[] = [
    { name: 'top', label: 'Top', normal: [0, 0, 1], icon: <ChevronUp className="w-4 h-4" /> },
    { name: 'bottom', label: 'Bottom', normal: [0, 0, -1], icon: <ChevronDown className="w-4 h-4" /> },
    { name: 'front', label: 'Front', normal: [0, 1, 0], icon: <ChevronDown className="w-4 h-4 rotate-90" /> },
    { name: 'back', label: 'Back', normal: [0, -1, 0], icon: <ChevronDown className="w-4 h-4 -rotate-90" /> },
    { name: 'left', label: 'Left', normal: [-1, 0, 0], icon: <ChevronLeft className="w-4 h-4" /> },
    { name: 'right', label: 'Right', normal: [1, 0, 0], icon: <ChevronRight className="w-4 h-4" /> },
  ];
  
  return (
    <div 
      ref={cubeRef}
      className="absolute top-4 right-4 w-20 h-20 perspective-800"
      style={{ pointerEvents: 'auto' }}
    >
      <div className="relative w-full h-full">
        {faces.map((face) => {
          const [nx, ny, nz] = face.normal;
          const x = (nx * 20) + 30;
          const y = (ny * 20) + 30;
          const z = (nz * 20) + 30;
          
          const isTop = nz === 1;
          const isBottom = nz === -1;
          const isFront = ny === 1;
          const isBack = ny === -1;
          const isLeft = nx === -1;
          const isRight = nx === 1;
          
          let transform = '';
          if (isTop) transform = 'translateZ(20px) rotateX(0deg)';
          else if (isBottom) transform = 'translateZ(20px) rotateX(180deg) rotate(180deg)';
          else if (isFront) transform = 'translateY(20px) rotateX(-90deg)';
          else if (isBack) transform = 'translateY(-20px) rotateX(90deg)';
          else if (isLeft) transform = 'translateX(-20px) rotateY(90deg)';
          else if (isRight) transform = 'translateX(20px) rotateY(-90deg)';
          
          return (
            <div
              key={face.name}
              className="absolute w-10 h-10 border-2 border-fg/50 rounded flex items-center justify-center transition-all"
              style={{
                left: '50%',
                top: '50%',
                marginLeft: -20,
                marginTop: -20,
                transformOrigin: 'center',
                transform: `translate(-50%, -50%) ${transform}`,
                backgroundColor: hoveredFace === face.name ? 'var(--accent)' : 'rgba(0,0,0,0.3)',
                opacity: 0.7,
                backdropFilter: 'blur(2px)',
              }}
              onMouseEnter={() => setHoveredFace(face.name)}
              onMouseLeave={() => setHoveredFace(null)}
              onClick={() => setView(face.name)}
              title={face.label}
            >
              <span style={{ 
                color: hoveredFace === face.name ? 'white' : 'var(--fg-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 'bold',
                textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                zIndex: 2,
              }}>
                {face.label}
              </span>
            </div>
          );
        })}
        
        {/* Edges */}
        {[
          { from: 'top', to: 'right' },
          { from: 'top', to: 'back' },
          { from: 'top', to: 'left' },
          { from: 'top', to: 'front' },
          { from: 'bottom', to: 'right' },
          { from: 'bottom', to: 'back' },
          { from: 'bottom', to: 'left' },
          { from: 'bottom', to: 'front' },
        ].map((edge) => {
          const from = faces.find((f) => f.name === edge.from)!;
          const to = faces.find((f) => f.name === edge.to)!;
          const fx = from.normal[0] * 30;
          const fy = from.normal[1] * 30;
          const tx = to.normal[0] * 30;
          const ty = to.normal[1] * 30;
          const tz = (from.normal[2] + to.normal[2]) * 30;
          
          const x1 = 30 + fx;
          const y1 = 30 - fy;
          const x2 = 30 + tx;
          const y2 = 30 - ty;
          
          const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
          const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
          
          return (
            <div
              key={`${edge.from}-${edge.to}`}
              className="absolute bg-fg/30"
              style={{
                left: `${x1}px`,
                top: `${y1}px`,
                width: `${length}px`,
                height: '2px',
                transform: `rotate(${angle}deg)`,
                transformOrigin: '0 0',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};