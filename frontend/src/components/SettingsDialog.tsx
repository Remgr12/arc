import React, { useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Settings } from '@/types';

export const SettingsDialog: React.FC = () => {
  const { settings, setSettings, closePreferences } = useAppStore((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
    closePreferences: state.setPreferencesOpen,
  }));
  
  const handleThemeChange = useCallback((theme: Settings['theme']) => {
    setSettings({ ...settings, theme });
  }, [settings, setSettings]);
  
  const handleToggle = useCallback((key: keyof Settings) => {
    setSettings({ ...settings, [key]: !settings[key] });
  }, [settings, setSettings]);
  
  return (
    <div className="settings-dialog-overlay" onClick={() => closePreferences(false)}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
        </div>
        
        <div className="settings-content">
          <div className="settings-section">
            <h3>Appearance</h3>
            
            <div className="setting-group">
              <label>Theme</label>
              <select 
                value={settings.theme} 
                onChange={(e) => handleThemeChange(e.target.value as Settings['theme'])}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="high-contrast">High Contrast</option>
                <option value="shapr3d">Shapr3D</option>
                <option value="autocad">AutoCAD</option>
                <option value="blender-dark">Blender Dark</option>
                <option value="monokai-pro">Monokai Pro</option>
                <option value="solarized">Solarized</option>
              </select>
            </div>
            
            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={settings.showGrid} 
                  onChange={() => handleToggle('showGrid')} 
                />
                Show Grid
              </label>
            </div>
            
            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={settings.showAxes} 
                  onChange={() => handleToggle('showAxes')} 
                />
                Show Axes
              </label>
            </div>
            
            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={settings.showSnapIndicator} 
                  onChange={() => handleToggle('showSnapIndicator')} 
                />
                Show Snap Indicator
              </label>
            </div>
            
            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={settings.orthoMode} 
                  onChange={() => handleToggle('orthoMode')} 
                />
                Orthographic View
              </label>
            </div>
          </div>
          
          <div className="settings-section">
            <h3>Viewport</h3>
            
            <div className="setting-group">
              <label>Navigation Mode</label>
              <select>
                <option>Standard</option>
                <option>Shapr3D</option>
                <option>Blender</option>
                <option>AutoCAD</option>
              </select>
            </div>
            
            <div className="setting-group">
              <label>Background Color</label>
              <input 
                type="color" 
                value={settings.viewportBackground.replace(' ', '')} 
                onChange={(e) => setSettings({ ...settings, viewportBackground: e.target.value })}
              />
            </div>
          </div>
          
          <div className="settings-section">
            <h3>Modeling</h3>
            
            <div className="setting-row">
              <label>
                <input 
                  type="checkbox" 
                  checked={settings.snapEnabled} 
                  onChange={() => handleToggle('snapEnabled')} 
                />
                Enable Snapping
              </label>
            </div>
            
            <div className="setting-group">
              <label>Snaplines</label>
              <input 
                type="range" 
                min="0" 
                max="50" 
                value={settings.snapTolerance ?? 5} 
                onChange={(e) => setSettings({ ...settings, snapTolerance: parseInt(e.target.value) })}
              />
            </div>
          </div>
        </div>
        
        <div className="settings-footer">
          <button className="btn btn-secondary" onClick={() => closePreferences(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => closePreferences(false)}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;