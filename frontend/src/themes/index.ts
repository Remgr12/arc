import { Theme } from '@/types';

export const THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Dark theme with blue accent',
    isBuiltIn: true,
    colors: {
      '--bg': '#0d0d0f',
      '--bg-secondary': '#141418',
      '--bg-tertiary': '#1c1c22',
      '--fg': '#e8e8ec',
      '--fg-muted': '#8a8a94',
      '--accent': '#00a8ff',
      '--accent-hover': '#0097e6',
      '--border': '#2a2a32',
      '--border-focus': '#00a8ff',
      '--success': '#10b981',
      '--warning': '#f59e0b',
      '--error': '#ef4444',
      '--panel': '#18181e',
      '--panel-hover': '#1e1e26',
      '--toolbar': '#141418',
      '--viewport': '#0d0d0f',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Light theme with blue accent',
    isBuiltIn: true,
    colors: {
      '--bg': '#f5f5f7',
      '--bg-secondary': '#ffffff',
      '--bg-tertiary': '#ebebef',
      '--fg': '#1d1d1f',
      '--fg-muted': '#6e6e73',
      '--accent': '#0071e3',
      '--accent-hover': '#005bb5',
      '--border': '#d2d2d7',
      '--border-focus': '#0071e3',
      '--success': '#30a14e',
      '--warning': '#bf8700',
      '--error': '#d1242f',
      '--panel': '#ffffff',
      '--panel-hover': '#f5f5f7',
      '--toolbar': '#ffffff',
      '--viewport': '#e8e8ec',
    },
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    description: 'High contrast theme for accessibility',
    isBuiltIn: true,
    colors: {
      '--bg': '#000000',
      '--bg-secondary': '#0a0a0a',
      '--bg-tertiary': '#1a1a1a',
      '--fg': '#ffffff',
      '--fg-muted': '#cccccc',
      '--accent': '#00ffff',
      '--accent-hover': '#00e6e6',
      '--border': '#ffffff',
      '--border-focus': '#00ffff',
      '--success': '#00ff00',
      '--warning': '#ffff00',
      '--error': '#ff0000',
      '--panel': '#0a0a0a',
      '--panel-hover': '#1a1a1a',
      '--toolbar': '#0a0a0a',
      '--viewport': '#000000',
    },
  },
  {
    id: 'shapr3d',
    name: 'Shapr3D',
    description: 'Inspired by Shapr3D\'s clean white UI',
    isBuiltIn: true,
    colors: {
      '--bg': '#f5f5f7',
      '--bg-secondary': '#ffffff',
      '--bg-tertiary': '#f0f0f2',
      '--fg': '#1d1d1f',
      '--fg-muted': '#868686',
      '--accent': '#007aff',
      '--accent-hover': '#0066e0',
      '--border': '#d2d2d7',
      '--border-focus': '#007aff',
      '--success': '#34c759',
      '--warning': '#ff9500',
      '--error': '#ff3b30',
      '--panel': '#ffffff',
      '--panel-hover': '#f5f5f7',
      '--toolbar': '#ffffff',
      '--viewport': '#f0f0f2',
    },
  },
  {
    id: 'autocad',
    name: 'AutoCAD',
    description: 'Inspired by AutoCAD\'s dark interface',
    isBuiltIn: true,
    colors: {
      '--bg': '#2b2b2b',
      '--bg-secondary': '#3c3c3c',
      '--bg-tertiary': '#4d4d4d',
      '--fg': '#e8e8e8',
      '--fg-muted': '#a0a0a0',
      '--accent': '#0078d7',
      '--accent-hover': '#106ebe',
      '--border': '#5a5a5a',
      '--border-focus': '#0078d7',
      '--success': '#84b59a',
      '--warning': '#ffcc00',
      '--error': '#f44444',
      '--panel': '#2b2b2b',
      '--panel-hover': '#3c3c3c',
      '--toolbar': '#3c3c3c',
      '--viewport': '#1d1d1d',
    },
  },
  {
    id: 'blender-dark',
    name: 'Blender Dark',
    description: 'Inspired by Blender\'s dark theme',
    isBuiltIn: true,
    colors: {
      '--bg': '#212121',
      '--bg-secondary': '#2c2c2c',
      '--bg-tertiary': '#333333',
      '--fg': '#e0e0e0',
      '--fg-muted': '#a0a0a0',
      '--accent': '#31a8ff',
      '--accent-hover': '#0090ff',
      '--border': '#3c3c3c',
      '--border-focus': '#31a8ff',
      '--success': '#45b35b',
      '--warning': '#f2ba44',
      '--error': '#ff6b6b',
      '--panel': '#2c2c2c',
      '--panel-hover': '#333333',
      '--toolbar': '#2c2c2c',
      '--viewport': '#1a1a1a',
    },
  },
  {
    id: 'monokai-pro',
    name: 'Monokai Pro',
    description: 'Monokai-inspired theme',
    isBuiltIn: true,
    colors: {
      '--bg': '#23262e',
      '--bg-secondary': '#2d313d',
      '--bg-tertiary': '#383e4f',
      '--fg': '#d4d4d4',
      '--fg-muted': '#8a8a94',
      '--accent': '#fc8258',
      '--accent-hover': '#ff9068',
      '--border': '#383e4f',
      '--border-focus': '#fc8258',
      '--success': '#95e695',
      '--warning': '#f1f693',
      '--error': '#ff6e7f',
      '--panel': '#2d313d',
      '--panel-hover': '#383e4f',
      '--toolbar': '#2d313d',
      '--viewport': '#1e212e',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'Solarized dark theme',
    isBuiltIn: true,
    colors: {
      '--bg': '#002535',
      '--bg-secondary': '#003547',
      '--bg-tertiary': '#00405a',
      '--fg': '#d8d8d8',
      '--fg-muted': '#8a8a94',
      '--accent': '#2aa1d6',
      '--accent-hover': '#1ba3e8',
      '--border': '#00405a',
      '--border-focus': '#2aa1d6',
      '--success': '#859900',
      '--warning': '#b58900',
      '--error': '#dc322f',
      '--panel': '#003547',
      '--panel-hover': '#00405a',
      '--toolbar': '#003547',
      '--viewport': '#002535',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    description: 'Solarized light theme',
    isBuiltIn: true,
    colors: {
      '--bg': '#fbf4e3',
      '--bg-secondary': '#f6eee0',
      '--bg-tertiary': '#eee8dd',
      '--fg': '#586e75',
      '--fg-muted': '#93a1a1',
      '--accent': '#268bd2',
      '--accent-hover': '#3a95dd',
      '--border': '#e0d6c5',
      '--border-focus': '#268bd2',
      '--success': '#859900',
      '--warning': '#b58900',
      '--error': '#dc322f',
      '--panel': '#fefae9',
      '--panel-hover': '#f6eee0',
      '--toolbar': '#f6eee0',
      '--viewport': '#fdf6e3',
    },
  },
];

export const useTheme = () => {
  const applyTheme = (theme: Theme) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme.id);
    
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  };
  
  const createCustomTheme = (
    name: string,
    colors: Record<string, string>,
    description = ''
  ): Theme => {
    const theme: Theme = {
      id: `custom-${name.toLowerCase().replace(/\s+/g, '-')}`,
      name,
      description,
      isBuiltIn: false,
      colors,
    };
    
    return theme;
  };
  
  const generateThemeFromBase = (
    base: Theme,
    overrides: Partial<Record<keyof Theme['colors'], string>>
  ): Theme => {
    const theme: Theme = { ...base };
    theme.id = `derived-${base.id}`;
    theme.name = `${base.name} (Modified)`;
    theme.isBuiltIn = false;
    
    Object.entries(overrides).forEach(([key, value]) => {
      if (value !== undefined) {
        (theme.colors as Record<string, string>)[key] = value;
      }
    });
    
    return theme;
  };
  
  const getContrastColor = (bg: string): string => {
    const match = bg.match(/\w+\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/) 
      || bg.match(/#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
    
    let r = 0, g = 0, b = 0;
    
    if (match) {
      if (match[0].startsWith('#')) {
        r = parseInt(match[1], 16) / 255;
        g = parseInt(match[2], 16) / 255;
        b = parseInt(match[3], 16) / 255;
      } else {
        r = parseFloat(match[1]);
        g = parseFloat(match[2]);
        b = parseFloat(match[3]);
      }
    }
    
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };
  
  const generateAccentColors = (baseColor: string) => {
    const match = baseColor.match(/#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
    
    if (!match) return { accent: baseColor, hover: baseColor, focus: baseColor };
    
    const r = parseInt(match[1], 16);
    const g = parseInt(match[2], 16);
    const b = parseInt(match[3], 16);
    
    const lighten = (amount: number) => {
      const factor = 1 + amount;
      return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    };
    
    const darken = (amount: number) => {
      const factor = 1 - amount;
      return `rgb(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)})`;
    };
    
    return {
      accent: baseColor,
      hover: darken(0.1),
      focus: lighten(0.2),
    };
  };
  
  return {
    themes: THEMES,
    applyTheme,
    createCustomTheme,
    generateThemeFromBase,
    getContrastColor,
    generateAccentColors,
  };
};
