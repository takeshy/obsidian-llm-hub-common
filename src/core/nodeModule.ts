/**
 * Desktop-only access to Node's built-in modules. Obsidian exposes `require` on
 * the window; a mobile build has none, so callers must reach for this lazily and
 * handle the throw rather than importing a Node module at load time.
 */
export function getNodeModule<T>(id: string): T {
  type Loader = { require?: (id: string) => unknown; module?: { require?: (id: string) => unknown } };
  const candidates: (Loader | undefined)[] = [
    typeof activeWindow !== "undefined" ? (activeWindow as unknown as Loader) : undefined,
    typeof window !== "undefined" ? (window as unknown as Loader) : undefined,
  ];
  for (const candidate of candidates) {
    const loader = candidate?.require || candidate?.module?.require;
    if (loader) return loader(id) as T;
  }
  throw new Error(`Node.js ${id} module is not available in this environment`);
}
