declare module '@sparticuz/chromium' {
  interface ChromiumModule {
    args: string[];
    headless: boolean;
    executablePath(): Promise<string>;
    defaultViewport?: { width: number; height: number } | null;
  }

  const chromium: ChromiumModule;
  export default chromium;
}
