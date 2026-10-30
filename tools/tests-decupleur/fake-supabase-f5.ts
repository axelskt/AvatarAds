// Base factice du banc de la faille 5 (audit Décupleur 30/10) : la base en mémoire des bancs Whop (FakeDB) + le stockage
// factice du banc Décupleur (FakeStorage), signé comme le VRAI createSignedUrl (`<SUPABASE_URL>/storage/v1/object/sign/
// <bucket>/<chemin>?token=<jeton>`, la forme que kie-proxy attend), une session lue dans l'en-tête Authorization (authUser
// de guard.ts) et les modèles JS des fonctions SQL de réservation utilisées par kie-proxy / reconcile-kie :
//   rate_hit, has_recent_debit, resolve_op, draw_reservation, draw_omni_reservation (20260906…, 20260925230000) ;
//   kie_job_bill (20260925230000 : settle / release / refund, exactement une fois) — à garder identiques.
import { FakeDB, createClient as baseClient } from '../tests-whop-webhook/fake-supabase.ts'
import { FakeStorage } from './fake-supabase-dc.ts'
export { FakeDB, FakeStorage }

const toBytes = async (d: unknown): Promise<Uint8Array> =>
  d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Blob ? new Uint8Array(await d.arrayBuffer()) : new TextEncoder().encode(String(d))
// jeton au format JWT (trois morceaux base64url), comme ceux du stockage Supabase
export const JETON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cmwiOiJyZW5kZXItbWVkaWEveCJ9.c2lnbmF0dXJlX2Zha2U-_x'
export const signe = (base: string, b: string, p: string) => `${base}/storage/v1/object/sign/${b}/${p}?token=${JETON}`

function bucket(st: FakeStorage, base: string, b: string) {
  return {
    createSignedUrl: async (p: string, _ttl: number) => st.has(b, p) ? { data: { signedUrl: signe(base, b, p) }, error: null } : { data: null, error: { message: 'Object not found' } },
    list: async (dir: string, o?: { search?: string }) => ({
      data: st.noms(b).filter((p) => p.lastIndexOf('/') === dir.length && p.startsWith(dir + '/')).map((p) => p.slice(dir.length + 1))
        .filter((n) => !o?.search || n.includes(o.search)).map((n) => ({ name: n })),
      error: null }),
    copy: async (from: string, to: string) => { const x = st.o.get(st.k(b, from)); if (!x) return { data: null, error: { message: 'Object not found' } }; st.o.set(st.k(b, to), { ...x }); return { data: { path: to }, error: null } },
    upload: async (p: string, d: unknown, o?: { contentType?: string }) => { st.put(b, p, await toBytes(d), o?.contentType || 'application/octet-stream'); return { data: { path: p }, error: null } },
    remove: async (ps: string[]) => ({ data: ps.filter((p) => st.o.delete(st.k(b, p))).map((name) => ({ name })), error: null }),
  }
}

export function createClient(u: string, k: string, o?: { global?: { headers?: Record<string, string> } }) {
  const c = baseClient(u, k, o) as Record<string, any>
  const db: FakeDB = (globalThis as any).__db, st: FakeStorage = (globalThis as any).__st
  const bearer = String(o?.global?.headers?.Authorization || '').replace(/^Bearer\s+/i, '')
  c.auth = { ...c.auth, getUser: async (tok?: string) => ({ data: { user: db.tokens?.[tok ?? bearer] ?? null }, error: null }) }
  c.storage = { from: (b: string) => bucket(st, u, b) }
  return c
}

// ── Modèles des fonctions SQL de réservation (une fonction SQL = un bloc synchrone sur la ligne verrouillée) ──
export function rpcsReservation(db: FakeDB) {
  const op = (id: string, user: string) => db.rows('credit_ops').find((r) => r.id === id && r.user_id === user)
  const prof = (id: string) => db.rows('profiles').find((r) => r.id === id)
  const draw = (a: any) => {
    const o = op(a.p_op, a.p_user); if (!o || o.settled_at || o.refunded_at) return null
    const rem = o.reserved_remaining ?? o.amount
    if (rem < a.p_cost) return null
    o.reserved_remaining = rem - a.p_cost
    db.rows('tirages').push({ op: o.id, amt: a.p_cost })
    return o.reserved_remaining
  }
  return {
    rate_hit: () => true,
    has_recent_debit: () => true,
    // l'indice n'est retenu que si c'est une op OUVERTE de l'utilisateur ; sinon sa dernière op ouverte
    resolve_op: (a: any) => {
      const open = db.rows('credit_ops').filter((r) => r.user_id === a.p_user && !r.settled_at && !r.refunded_at)
      return (open.find((r) => r.id === a.p_hint) || open[open.length - 1])?.id ?? null
    },
    draw_reservation: draw,
    draw_omni_reservation: (a: any) => { const r = draw(a); return r === null ? 0 : a.p_cost },
    // Motion Control : toute la réserve restante si elle couvre le plancher (0 sinon)
    draw_full_reservation: (a: any) => {
      const o = op(a.p_op, a.p_user); if (!o || o.settled_at || o.refunded_at) return 0
      const rem = o.reserved_remaining ?? o.amount; if (rem < a.p_min) return 0
      o.reserved_remaining = 0; db.rows('tirages').push({ op: o.id, amt: rem }); return rem
    },
    release_reservation: (a: any) => { const o = op(a.p_op, a.p_user); if (o && !o.settled_at && !o.refunded_at) o.reserved_remaining = Math.min(o.amount, (o.reserved_remaining ?? 0) + a.p_cost) },
    release_omni_reservation: (a: any) => { const o = op(a.p_op, a.p_user); if (o && !o.settled_at && !o.refunded_at) o.reserved_remaining = Math.min(o.amount, (o.reserved_remaining ?? 0) + a.p_drawn) },
    kie_job_bill: (a: any) => {
      const j = db.rows('kie_jobs').find((r) => r.task_id === a.p_task && r.user_id === a.p_user)
      if (!j) return { ok: false, reason: 'no_job', bill: null }
      if (!j.op_id) return { ok: false, reason: 'no_op', bill: 'none' }
      if (a.p_action === 'settle') {
        if (j.bill_state !== 'drawn') return { ok: false, reason: 'not_drawn', bill: j.bill_state }
        const o = op(j.op_id, a.p_user); if (o && !o.refunded_at) o.settled_at = new Date().toISOString()
        j.bill_state = 'settled'; db.rows('reglements').push({ task: j.task_id, op: j.op_id }); return { ok: true, bill: 'settled' }
      }
      if (a.p_action === 'release') {
        if (j.bill_state !== 'drawn') return { ok: false, reason: 'not_drawn', bill: j.bill_state }
        const o = op(j.op_id, a.p_user); if (o && !o.settled_at && !o.refunded_at) o.reserved_remaining = Math.min(o.amount, (o.reserved_remaining ?? 0) + (j.drawn || 0))
        j.bill_state = 'released'; return { ok: true, bill: 'released' }
      }
      if (!['drawn', 'released'].includes(j.bill_state)) return { ok: false, reason: 'not_open', bill: j.bill_state }
      const o = op(j.op_id, a.p_user)
      if (!o || o.refunded_at) { j.bill_state = 'closed'; return { ok: false, reason: o ? 'already_refunded' : 'unknown_op', bill: 'closed' } }
      if (o.settled_at) { j.bill_state = 'closed'; return { ok: false, reason: 'already_delivered', bill: 'closed' } }
      // op d'une seule étape (cas du banc) : tout ce qui a été débité revient au client
      o.refunded_at = new Date().toISOString(); o.reserved_remaining = 0
      const p = prof(a.p_user); if (p) p.credits_remaining = (p.credits_remaining || 0) + o.amount
      db.rows('remboursements').push({ task: j.task_id, op: o.id, amt: o.amount })
      j.bill_state = 'refunded'; return { ok: true, bill: 'refunded', refunded: o.amount }
    },
  }
}
