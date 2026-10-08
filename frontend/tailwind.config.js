/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // CSS variables will be defined in styles/globals.css
        bg: 'var(--bg)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        fg: 'var(--fg)',
        'fg-muted': 'var(--fg-muted)',
        accent: 'var(--accent)',
        'accent-hover': 'var(--accent-hover)',
        border: 'var(--border)',
        'border-focus': 'var(--border-focus)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        panel: 'var(--panel)',
        'panel-hover': 'var(--panel-hover)',
        toolbar: 'var(--toolbar)',
        viewport: 'var(--viewport)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      borderRadius: {
        'xl': '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        'panel': '0 2px 8px rgba(0, 0, 0, 0.15)',
        'panel-hover': '0 4px 16px rgba(0, 0, 0, 0.2)',
        'modal': '0 8px 32px rgba(0, 0, 0, 0.3)',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
      },
    },
  },
  plugins: [],
}