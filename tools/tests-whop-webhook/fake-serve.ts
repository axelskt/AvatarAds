export function serve(h: (req: Request) => Promise<Response>) { (globalThis as any).__handler = h }
