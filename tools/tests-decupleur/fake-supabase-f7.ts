// Base factice du banc faille 7 (30/10) : celle du banc Décupleur (fake-supabase-dc.ts) + ce que kie-proxy attend en plus :
// liens signés au format Supabase (<SUPABASE_URL>/storage/v1/object/sign/<bucket>/<chemin>?token=…, contrôlés par
// preparerVideoWan / okInput) et auth.getUser() qui lit le jeton de l'en-tête Authorization (authUser de guard.ts).
import { createClient as dcClient, FakeStorage } from './fake-supabase-dc.ts'
export * from './fake-supabase-dc.ts'

const toBytes = async (d: unknown): Promise<Uint8Array> =>
  d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new TextEncoder().encode(String(d))

export const signeSupabase = (base: string, b: string, p: string) => `${base}/storage/v1/object/sign/${b}/${p}?token=t`
function bucket(st: FakeStorage, b: string, base: string) {
  return {
    createSignedUrl: async (p: string) => st.has(b, p) ? { data: { signedUrl: signeSupabase(base, b, p) }, error: null } : { data: null, error: { message: 'Object not found' } },
    createSignedUrls: async (ps: string[]) => ({ data: ps.map((p) => ({ path: p, signedUrl: st.has(b, p) ? signeSupabase(base, b, p) : null, error: st.has(b, p) ? null : 'not found' })), error: null }),
    download: async (p: string) => { const x = st.o.get(st.k(b, p)); return x ? { data: new Blob([x.bytes as BlobPart], { type: x.mime }), error: null } : { data: null, error: { message: 'Object not found' } } },
    list: async (dir: string, o?: { search?: string }) => ({
      data: st.noms(b).filter((p) => p.lastIndexOf('/') === dir.length && p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1))
        .filter((n) => !o?.search || n.includes(o.search)).map((n) => ({ name: n, metadata: { size: st.o.get(st.k(b, dir + '/' + n))!.bytes.length } })), error: null }),
    copy: async (from: string, to: string) => { const x = st.o.get(st.k(b, from)); if (!x) return { data: null, error: { message: 'Object not found' } }; st.o.set(st.k(b, to), { ...x }); return { data: { path: to }, error: null } },
    upload: async (p: string, d: unknown, o?: { contentType?: string }) => { st.put(b, p, await toBytes(d), o?.contentType || 'application/octet-stream'); return { data: { path: p }, error: null } },
    remove: async (ps: string[]) => ({ data: ps.filter((p) => st.o.delete(st.k(b, p))).map((name) => ({ name })), error: null }),
  }
}

// deno-lint-ignore no-explicit-any
export function createClient(u: string, k: string, o?: any) {
  const c = dcClient(u, k, o) as Record<string, any>
  const st: FakeStorage = (globalThis as any).__st
  c.storage = { from: (b: string) => bucket(st, b, u) }
  const jeton = String(o?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
  const db = (globalThis as any).__db
  c.auth = { ...(c.auth || {}), getUser: async (t?: string) => ({ data: { user: db.tokens?.[t || jeton] ?? null }, error: null }) }
  return c
}
