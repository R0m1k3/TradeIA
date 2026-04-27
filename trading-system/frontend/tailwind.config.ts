import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0A0E1A',
        'bg-surface': '#111827',
        'bg-elevated': '#1C2333',
        'accent-green': '#00D4AA',
        'accent-red': '#FF4D6D',
        'accent-amber': '#FFB347',
        'accent-blue': '#4A9EFF',
        'text-primary': '#F0F4FF',
        'text-secondary': '#8892A4',
        border: '#1E2D45',
      },
      fontFamily: {
        syne: ['Syne', 'sans-serif'],
        mono: ['"DM Mono"', 'monospace'],
      },
      animation: {
        pulse2: 'pulse2 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        blink: 'blink 2s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        pulse2: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        slideIn: {
          from: { transform: 'translateX(110%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.2' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
