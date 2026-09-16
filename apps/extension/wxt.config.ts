import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    define: {
      __VCL_DEBUG_PROVENANCE__: JSON.stringify(process.env.VCL_DEBUG_PROVENANCE === 'true'),
    },
  }),
  manifest: {
    name: 'VCL',
    description: 'Select visible products in supported video and resolve useful purchase options.',
    permissions: ['activeTab'],
    host_permissions: ['http://127.0.0.1:8787/*', 'http://localhost:8787/*'],
    action: {
      default_title: 'Select product',
    },
    commands: {
      'toggle-scoop': {
        suggested_key: {
          default: 'Ctrl+Shift+S',
          mac: 'Command+Shift+S',
        },
        description: 'Open Scoop product selection',
      },
    },
  },
});
