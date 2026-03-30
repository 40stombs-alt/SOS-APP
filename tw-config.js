/**
 * S.O.S. — Shared Tailwind CSS Configuration
 * ─────────────────────────────────────────────────────────────
 * Load this BEFORE the Tailwind CDN script in every HTML page.
 * Centralises all design tokens so you only edit one file.
 *
 * Usage in HTML:
 *   <script src="./tw-config.js"></script>
 *   <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
 */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        /* ── Surface layers (Material Design 3) ── */
        'surface':                    '#f8f9ff',
        'surface-bright':             '#f8f9ff',
        'surface-dim':                '#c5dbff',
        'surface-container-lowest':   '#ffffff',
        'surface-container-low':      '#eff3ff',
        'surface-container':          '#e6eeff',
        'surface-container-high':     '#dde9ff',
        'surface-container-highest':  '#d3e3ff',
        'surface-variant':            '#d3e3ff',
        'surface-tint':               '#426088',
        'inverse-surface':            '#0d3157',
        'inverse-on-surface':         '#ebf1ff',
        'background':                 '#f8f9ff',

        /* ── On-surface text ── */
        'on-surface':                 '#001c39',
        'on-surface-variant':         '#43474e',
        'on-background':              '#001c39',

        /* ── Primary ── */
        'primary':                    '#00132a',
        'primary-container':          '#00284d',
        'primary-fixed':              '#d3e3ff',
        'primary-fixed-dim':          '#aac8f6',
        'on-primary':                 '#ffffff',
        'on-primary-container':       '#7290bb',
        'on-primary-fixed':           '#001c39',
        'on-primary-fixed-variant':   '#29486e',
        'inverse-primary':            '#aac8f6',

        /* ── Secondary ── */
        'secondary':                  '#366287',
        'secondary-container':        '#a8d3fe',
        'secondary-fixed':            '#cee5ff',
        'secondary-fixed-dim':        '#a0cbf5',
        'on-secondary':               '#ffffff',
        'on-secondary-container':     '#2f5b80',
        'on-secondary-fixed':         '#001d32',
        'on-secondary-fixed-variant': '#1a4a6e',

        /* ── Tertiary / teal accent ── */
        'tertiary':                   '#001619',
        'tertiary-container':         '#002d31',
        'tertiary-fixed':             '#7ff4ff',
        'tertiary-fixed-dim':         '#4bd9e5',
        'on-tertiary':                '#ffffff',
        'on-tertiary-container':      '#009ea9',
        'on-tertiary-fixed':          '#002022',
        'on-tertiary-fixed-variant':  '#004f55',

        /* ── Error ── */
        'error':              '#ba1a1a',
        'error-container':    '#ffdad6',
        'on-error':           '#ffffff',
        'on-error-container': '#93000a',

        /* ── Outline ── */
        'outline':         '#73777f',
        'outline-variant': '#c3c6cf',
      },
      fontFamily: {
        headline: ['Inter'],
        body:     ['Inter'],
        label:    ['Inter'],
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg:      '0.25rem',
        xl:      '0.5rem',
        full:    '0.75rem',
      },
    },
  },
};
