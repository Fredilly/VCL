import { defineConfig } from 'wxt';

export default defineConfig({
  vite: () => ({
    define: {
      __VCL_DEBUG_PROVENANCE__: JSON.stringify(process.env.VCL_DEBUG_PROVENANCE === 'true'),
    },
  }),
  manifest: {
    name: 'Scoop',
    short_name: 'Scoop',
    description: 'Select visible products in supported video and resolve useful purchase options.',
    icons: {
      16: 'icons/scoop-extension-16.png',
      32: 'icons/scoop-extension-32.png',
      48: 'icons/scoop-extension-48.png',
      128: 'icons/scoop-extension-128.png',
    },
    permissions: ['activeTab'],
    host_permissions: ['http://127.0.0.1:8787/*', 'http://localhost:8787/*'],
    action: {
      default_title: 'Scoop this item',
      default_icon: {
        16: 'icons/scoop-extension-16.png',
        32: 'icons/scoop-extension-32.png',
        48: 'icons/scoop-extension-48.png',
        128: 'icons/scoop-extension-128.png',
      },
    },
  },
});
