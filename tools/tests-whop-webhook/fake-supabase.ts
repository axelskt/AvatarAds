// Base factice en mémoire : juste ce que whop-webhook utilise (from/select/eq/gte/order/limit/maybeSingle/update/insert/
// upsert/delete, rpc, auth.admin.createUser avec l'effet du trigger handle_new_user non périmé).
type Row = Record<string, any>
const clone = (x: any) => JSON.parse(JSON.stringify(x))
const path = (r: Row, c: string) => c.includes('->') ? c.split(/->>?/).reduce((v: any, k) => v?.[k], r) : r[c]
export class FakeDB {
  t: Record<string, Row[]> = {}
  rpcs: Record<string, (a: any) => any> = {}
  log: string[] = []
  tokens: Record<string, any> = {}
  mdp: Record<string, boolean> = {}
  rows(name: string) { return (this.t[name] ||= []) }
}
const UNIQUE: Record<string, string> = { webhook_events: 'event_id', referral_earnings: 'dedupe_key' }
class Q {
  f: ((r: Row) => boolean)[] = []; op = 'select'; p: any = null; key = ''; lim = 0; ret = false
  constructor(public db: FakeDB, public name: string) {}
  select() { if (this.op !== 'select') this.ret = true; return this }   // après insert/update/delete : renvoie les lignes
  eq(c: string, v: any) { this.f.push((r) => String(path(r, c)) === String(v)); return this }
  gte(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) >= String(v)); return this }
  lte(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) <= String(v)); return this }
  like(c: string, pat: string) { const re = new RegExp('^' + pat.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'); this.f.push((r) => re.test(String(path(r, c) ?? ''))); return this }
  gt(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) > String(v)); return this }
  lt(c: string, v: any) { this.f.push((r) => path(r, c) != null && String(path(r, c)) < String(v)); return this }
  is(c: string, v: any) { this.f.push((r) => v === null ? path(r, c) == null : path(r, c) === v); return this }
  not(c: string, op: string, v: any) { this.f.push((r) => op === 'is' && v === null ? path(r, c) != null : String(path(r, c)) !== String(v)); return this }
  in(c: string, a: any[]) { this.f.push((r) => a.map(String).includes(String(path(r, c)))); return this }
  order() { return this }
  limit(n: number) { this.lim = n; return this }
  update(o: Row) { this.op = 'update'; this.p = o; return this }
  delete() { this.op = 'delete'; return this }
  insert(o: Row) { this.op = 'insert'; this.p = o; return this }
  upsert(o: Row, opt?: { onConflict?: string }) { this.op = 'upsert'; this.p = o; this.key = opt?.onConflict || 'id'; return this }
  run(): { data: any; error: any } {
    const rows = this.db.rows(this.name), hit = () => rows.filter((r) => this.f.every((f) => f(r)))
    if (this.op === 'select') { let d = hit(); if (this.lim) d = d.slice(0, this.lim); return { data: clone(d), error: null } }
    if (this.op === 'update') { const h = hit(); for (const r of h) Object.assign(r, clone(this.p)); this.db.log.push(`update ${this.name} ${JSON.stringify(this.p)}`); return { data: this.ret ? clone(h) : null, error: null } }
    if (this.op === 'delete') { const hh = hit(), h = new Set(hh); this.db.t[this.name] = rows.filter((r) => !h.has(r)); return { data: this.ret ? clone(hh) : null, error: null } }
    if (this.op === 'insert') {
      const u = UNIQUE[this.name]
      if (u && this.p[u] != null && rows.some((r) => r[u] === this.p[u])) return { data: null, error: { code: '23505', message: 'duplicate' } }
      const row = { id: crypto.randomUUID(), received_at: new Date().toISOString(), created_at: new Date().toISOString(), ...clone(this.p) }
      rows.push(row); return { data: this.ret ? [clone(row)] : null, error: null }
    }
    if (this.op === 'upsert') {
      const ex = rows.find((r) => r[this.key] === this.p[this.key])
      if (ex) Object.assign(ex, clone(this.p)); else rows.push(clone(this.p)); return { data: null, error: null }
    }
    return { data: null, error: null }
  }
  maybeSingle() { const r = this.run(); if (r.error) return Promise.resolve(r); const d = r.data || []
    return Promise.resolve(d.length > 1 ? { data: null, error: { code: 'PGRST116', message: 'multiple' } } : { data: d[0] ?? null, error: null }) }
  single() { return this.maybeSingle().then((r: any) => r.data ? r : { data: null, error: { code: 'PGRST116' } }) }
  then(ok: any, ko: any) { return Promise.resolve(this.run()).then(ok, ko) }
}
let n = 0
export function createClient(_u: string, _k: string, _o?: unknown) {
  const db: FakeDB = (globalThis as any).__db
  return {
    from: (name: string) => new Q(db, name),
    rpc: async (name: string, args: any) => ({ data: db.rpcs[name] ? db.rpcs[name](args) : null, error: null }),
    auth: {
      getUser: async (tok: string) => ({ data: { user: db.tokens?.[tok] ?? null }, error: null }),
      admin: {
      generateLink: async ({ email }: { email: string }) => { db.log.push('lien ' + email); return { data: { properties: { hashed_token: 'th_' + email } }, error: null } },
      updateUserById: async (id: string, attrs: any) => { db.log.push('maj ' + id + ' ' + JSON.stringify(attrs));
        const g = db.rows('password_change_grants').find((r) => r.user_id === id); if (g) { db.t.password_change_grants = db.rows('password_change_grants').filter((r) => r !== g); db.mdp = { ...(db.mdp || {}), [id]: true } }
        return { data: {}, error: null } },
      createUser: async ({ email }: { email: string }) => {
      if (db.rows('profiles').some((p) => p.email === email)) return { data: null, error: { message: 'already registered' } }
      const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
      const pa = db.rows('pending_activations').find((r) => r.email.toLowerCase() === email.toLowerCase())
      // handle_new_user (ligne non périmée) : achat en attente appliqué, crédits sans distinction pack/plan (bought 0)
      db.rows('profiles').push(pa
        ? { id, email, plan: pa.plan, credits_remaining: pa.credits, credits_total: pa.credits, img_bonus_credits: pa.img_credits || 0,
            whop_member_id: pa.whop_member_id ?? null, whop_plan_id: pa.whop_plan_id ?? null, first_sub_bonus_used: !!(pa.plan && pa.plan !== 'free'), bought_credits: 0 }
        : { id, email, plan: 'free', credits_remaining: 0, credits_total: 0, bought_credits: 0, first_sub_bonus_used: false })
      if (pa) db.t.pending_activations = db.rows('pending_activations').filter((r) => r !== pa)
      return { data: { user: { id } }, error: null }
    } } },
  }
}
