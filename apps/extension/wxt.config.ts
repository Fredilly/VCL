import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'VCL',
    description: 'Select visible products in supported video and resolve useful purchase options.',
    permissions: ['activeTab'],
    action: {
      default_title: 'Select product',
    },
  },
});
