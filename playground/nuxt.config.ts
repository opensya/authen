import { resolve } from 'node:path';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  alias: {
    '@core': resolve(__dirname, '../src'),
  },

  runtimeConfig: {
    databaseUrl: '',

    public: {
      authUri: '',
    },
  },

  modules: ['@nuxt/ui'],

  css: ['~/assets/css/main.css'],
});
