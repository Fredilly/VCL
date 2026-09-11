import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'VCL',
    description: 'Select visible products in supported video and resolve useful purchase options.',
    permissions: ['activeTab'],
    host_permissions: ['http://127.0.0.1:8787/*', 'http://localhost:8787/*'],
    action: {
      default_title: 'Select product',
    },
  },
});
