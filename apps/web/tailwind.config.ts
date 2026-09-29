import type { Config } from 'tailwindcss';

// Semantic tokens resolve to CSS variables declared in app/globals.css (the
// single source of truth for the palette: preto #020001, caramelo #9F6118,
// dourado #C88A3A, bege #E5C08A, creme #F6E7CF). Components use these
// semantic classes, never hex values. See docs/UI_DESIGN_SYSTEM.md.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Raw brand palette — prefer the semantic names below.
        brand: {
          primary: token('brand-primary'),
          dark: token('brand-dark'),
          accent: token('brand-accent'),
          muted: token('brand-muted'),
          light: token('brand-light'),
        },
        background: token('background'),
        foreground: token('foreground'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-hover': token('surface-hover'),
        sidebar: token('sidebar'),
        // `line` = the `--border` token (kept as `line` so `border-line`
        // doesn't read as `border-border`).
        line: token('border'),
        'line-strong': token('border-strong'),
        primary: token('primary'),
        'primary-foreground': token('primary-foreground'),
        'primary-hover': token('primary-hover'),
        accent: token('accent'),
        'accent-foreground': token('accent-foreground'),
        muted: token('muted'),
        'muted-foreground': token('muted-foreground'),
        subtle: token('subtle'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
        'danger-foreground': token('danger-foreground'),
        info: token('info'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        heading: ['var(--font-heading)'],
      },
      borderRadius: {
        ctl: '0.5rem',
        card: '0.75rem',
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'none' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(var(--accent) / 0.5)' },
          '100%': { boxShadow: '0 0 0 10px rgb(var(--accent) / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'pop-in': 'pop-in 160ms ease-out',
        'slide-in-left': 'slide-in-left 200ms ease-out',
        'toast-in': 'toast-in 180ms ease-out',
        'pulse-ring': 'pulse-ring 1.4s ease-out 1',
      },
    },
  },
  plugins: [],
};

export default config;
