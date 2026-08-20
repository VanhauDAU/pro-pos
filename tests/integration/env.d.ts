declare module 'cloudflare:workers' {
  interface ProvidedEnv extends CloudflareBindings {
    TEST_MIGRATIONS: unknown;
  }
}
