// Base factice du banc Décupleur (30/10) : la base en mémoire des bancs Whop (FakeDB, requêtes from/select/eq/update…)
// + un STOCKAGE factice (render-media, mcp-media) + les modèles JS des fonctions SQL de crédits du MCP
// (migration 20261002180000_mcp_credits_par_job.sql : mcp_spend_for_job, mcp_job_partial_refund, mcp_job_fail_refund ;
// à garder identiques). Le client du navigateur (l'attaquant) n'agit que sur render-media/<son uid>/… : mêmes règles que
// les policies render_media_user_* (storage.foldername(name)[1] = auth.uid()).
import { FakeDB, createClient as baseClient } from '../tests-whop-webhook/fake-supabase.ts'
export { FakeDB }

type Obj = { bytes: Uint8Array, mime: string }
export class FakeStorage {
  o = new Map<string, Obj>()
  k = (b: string, p: string) => b + '|' + p
  has(b: string, p: string) { return this.o.has(this.k(b, p)) }
  put(b: string, p: string, bytes: Uint8Array, mime = 'video/mp4') { this.o.set(this.k(b, p), { bytes, mime }) }
  noms(b: string) { return [...this.o.keys()].filter((x) => x.startsWith(b + '|')).map((x) => x.slice(b.length + 1)) }
  // ce que le CLIENT peut supprimer / lire lui-même (policies storage) : render-media/<uid>/…
  duClient(uid: string) { return this.noms('render-media').filter((p) => p.split('/')[0] === uid) }
  clientSupprimeTout(uid: string) { const l = this.duClient(uid); for (const p of l) this.o.delete(this.k('render-media', p)); return l }
}
export const SIGNE = 'https://stock.test/sign/'

const toBytes = async (d: unknown): Promise<Uint8Array> =>
  d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new TextEncoder().encode(String(d))

function bucket(st: FakeStorage, b: string) {
  const url = (p: string) => `${SIGNE}${b}/${p}?token=t`
  return {
    createSignedUrl: async (p: string, _ttl: number, _o?: unknown) => st.has(b, p) ? { data: { signedUrl: url(p) }, error: null } : { data: null, error: { message: 'Object not found' } },
    createSignedUrls: async (ps: string[], _ttl: number, _o?: unknown) => ({ data: ps.map((p) => ({ path: p, signedUrl: st.has(b, p) ? url(p) : null, error: st.has(b, p) ? null : 'not found' })), error: null }),
    download: async (p: string) => { const x = st.o.get(st.k(b, p)); return x ? { data: new Blob([x.bytes as BlobPart], { type: x.mime }), error: null } : { data: null, error: { message: 'Object not found' } } },
    list: async (dir: string, o?: { search?: string }) => ({
      data: st.noms(b).filter((p) => p.lastIndexOf('/') === dir.length && p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1))
        .filter((n) => !o?.search || n.includes(o.search)).map((n) => { const x = st.o.get(st.k(b, dir + '/' + n))!; return { name: n, metadata: { size: x.bytes.length, mimetype: x.mime } } }),
      error: null }),
    copy: async (from: string, to: string) => { const x = st.o.get(st.k(b, from)); if (!x) return { data: null, error: { message: 'Object not found' } }; st.o.set(st.k(b, to), { ...x }); return { data: { path: to }, error: null } },
    upload: async (p: string, d: unknown, o?: { contentType?: string }) => { st.put(b, p, await toBytes(d), o?.contentType || 'application/octet-stream'); return { data: { path: p }, error: null } },
    remove: async (ps: string[]) => { const out = ps.filter((p) => st.o.delete(st.k(b, p))).map((name) => ({ name })); return { data: out, error: null } },
  }
}

export function createClient(u: string, k: string, o?: unknown) {
  const c = baseClient(u, k, o) as Record<string, unknown>
  const st: FakeStorage = (globalThis as any).__st
  c.storage = { from: (b: string) => bucket(st, b) }
  return c
}

// ── Modèles des fonctions SQL (20261002180000) : d'un bloc synchrone = une transaction sur la ligne verrouillée ──
export function rpcsCreditsMcp(db: FakeDB) {
  const job = (id: string) => db.rows('mcp_jobs').find((r) => r.id === id)
  const prof = (id: string) => db.rows('profiles').find((r) => r.id === id)
  const creditBack = (user: string, jobId: string, amt: number) => {
    const p = prof(user); if (!p) throw new Error('no_profile')
    p.credits_remaining = (p.credits_remaining || 0) + amt
    db.rows('remboursements').push({ job_id: jobId, amt })
  }
  return {
    rate_hit: () => true,
    mcp_spend_for_job: (a: any) => {
      const j = job(a.p_job); if (!j || j.user_id !== a.p_user) throw new Error('no_job')
      if (j.status !== 'running' || j.refunded || (j.credits_cost || 0) !== 0) return -2
      const p = prof(a.p_user); if (!p || (p.credits_remaining || 0) < a.p_cost) return -1
      p.credits_remaining -= a.p_cost
      j.credits_cost = a.p_cost
      db.rows('debits').push({ job_id: j.id, amt: a.p_cost })
      return p.credits_remaining
    },
    mcp_job_partial_refund: (a: any) => {
      if (!(a.p_amt > 0) || !a.p_tag || a.p_tag.length > 40) return 0
      const j = job(a.p_job); if (!j || j.status !== 'running' || j.refunded) return 0
      const parts: string[] = j.params?.partials || []
      if (parts.includes(a.p_tag)) return 0
      const amt = Math.min(a.p_amt, j.credits_cost || 0); if (amt <= 0) return 0
      j.credits_cost -= amt; j.params = { ...(j.params || {}), partials: [...parts, a.p_tag] }
      creditBack(j.user_id, j.id, amt); return amt
    },
    mcp_job_fail_refund: (a: any) => {
      const j = job(a.p_job); if (!j || j.status !== 'running' || j.refunded) return -1
      if (a.p_only_op != null && j.op_name !== a.p_only_op) return -1
      let amt = j.credits_cost || 0
      if (a.p_max != null && a.p_max > 0) amt = Math.min(amt, a.p_max)
      Object.assign(j, { status: 'failed', error: String(a.p_reason || 'échec').slice(0, 500), refunded: true })
      if (amt > 0) creditBack(j.user_id, j.id, amt)
      return amt
    },
  }
}
