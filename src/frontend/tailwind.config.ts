import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'var(--color-border)',
        input: 'var(--color-border)',
        ring: 'var(--color-accent, #2f78ba)',
        background: 'var(--color-background)',
        foreground: 'var(--color-text)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          foreground: '#ffffff',
        },
        secondary: {
          DEFAULT: 'var(--color-primary-dark)',
          foreground: '#ffffff',
        },
        muted: {
          DEFAULT: 'var(--color-background-soft)',
          foreground: 'var(--color-text-light)',
        },
        accent: {
          DEFAULT: 'var(--color-accent, #2f78ba)',
          foreground: 'var(--color-text)',
        },
        destructive: {
          DEFAULT: '#dc2626',
          foreground: '#ffffff',
        },
        card: {
          DEFAULT: 'var(--color-card-background)',
          foreground: 'var(--color-text)',
        },
        heading: 'var(--color-heading)',
        'surface-soft': 'var(--color-background-soft)',
        'surface-mute': 'var(--color-background-mute)',
        mc: {
          grass: '#5BA046',
          pixel: '#E8923C',
          stone: '#7E7E7E',
          diamond: '#5DCEDA',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '12px',
        '2xl': '22px',
        '3xl': '26px',
      },
      fontFamily: {
        sans: [
          'HarmonyOS Sans SC',
          'Microsoft YaHei UI',
          'PingFang SC',
          'Segoe UI Variable',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
      },
      boxShadow: {
        surface: '0 10px 24px rgba(66, 82, 105, 0.08)',
        'surface-hover': '0 14px 30px rgba(66, 82, 105, 0.13)',
        hero: '0 22px 40px rgba(44, 71, 99, 0.18)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
