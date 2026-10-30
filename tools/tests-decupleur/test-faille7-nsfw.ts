// Banc de l'audit Décupleur du 30/10, faille 7 : « le filtre de contenu explicite du fournisseur est coupé pour tous les
// clients » (Wan 3.0 chez kie, nsfw_checker: false). CODE RÉEL de supabase/functions/kie-proxy/handler.ts (changement de
// personnage de l'app) et de supabase/functions/mcp/index.ts (outil decupler_video), sur base / stockage / kie.ai factices ;
// + la phrase que l'app montre (app/index.html, _dcRun). AUCUN réseau : le corps envoyé à kie est CAPTURÉ, jamais envoyé.
// Vérifie aussi que le REFUS du fournisseur est traduit et remboursé (app : kie-proxy rend puis rembourse, KIE_NO_FALLBACK ;
// MCP : étape dw: en échec → tout rendu, message « modération »).
//   cd tools/tests-decupleur && deno run --allow-env --allow-read --allow-write --allow-run=ffmpeg --import-map=import_map_f7.json test-faille7-nsfw.ts
//   FONCTIONS=/chemin/vers/supabase/functions APP_HTML=/chemin/app/index.html … → une autre version (AVANT : ab-faille678.sh)
import { FakeDB, FakeStorage, rpcsCreditsMcp, signeSupabase } from './fake-supabase-f7.ts'

const BASE = 'https://test.local'
for (const [k, v] of Object.entries({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'a', KIEAI_API_KEY: 'k', DECUPLEUR_OUVERT: '1' })) Deno.env.set(k, v)
const keep = console.log
let logs: string[] = []
for (const m of ['log', 'warn', 'error', 'info'] as const) (console as any)[m] = (...a: unknown[]) => logs.push(a.map(String).join(' '))

const db = new FakeDB(); (globalThis as any).__db = db
const st = new FakeStorage(); (globalThis as any).__st = st
try { (Deno as any).resolveDns = async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] } catch { Object.defineProperty(Deno, 'resolveDns', { value: async (_h: string, t: string) => t === 'A' ? ['93.184.216.34'] : [] }) }

// vraie petite vidéo MP4 de 5 s (fabriquée ici, aucune vidéo réelle) : kie-proxy MESURE la référence avant d'envoyer
const tmp = await Deno.makeTempDir({ prefix: 'banc-f7-' })
const g = await new Deno.Command('ffmpeg', { args: ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x320:rate=15', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${tmp}/ref.mp4`] }).output()
if (!g.success) { keep('ffmpeg indisponible :', new TextDecoder().decode(g.stderr)); Deno.exit(2) }
const REF = await Deno.readFile(`${tmp}/ref.mp4`)
await Deno.remove(tmp, { recursive: true })

// ── kie.ai factice : corps de createTask capturés ; état des tâches réglable ──
const envois: any[] = []
const etat: Record<string, { state: string; failMsg?: string; failCode?: string }> = {}
let n = 0
const SIGN = `${BASE}/storage/v1/object/sign/`
globalThis.fetch = (async (u: any, o: any) => {
  const s = String(u instanceof Request ? u.url : u)
  if (s.startsWith(SIGN)) {
    const [b, ...rest] = s.slice(SIGN.length).split('?')[0].split('/')
    const x = st.o.get(st.k(b, rest.join('/')))
    if (!x) return new Response('nf', { status: 404 })
    const rg = /bytes=(\d+)-(\d+)/.exec(new Headers(o?.headers).get('range') || '')
    if (rg) { const a = +rg[1], z = Math.min(+rg[2], x.bytes.length - 1); return new Response(x.bytes.slice(a, z + 1) as BodyInit, { status: 206, headers: { 'content-range': `bytes ${a}-${z}/${x.bytes.length}` } }) }
    return new Response(x.bytes as BodyInit, { status: 200, headers: { 'content-type': x.mime, 'content-length': String(x.bytes.length) } })
  }
  if (s === 'https://api.kie.ai/api/v1/jobs/createTask') {
    const body = JSON.parse(String(o?.body || '{}')); envois.push(body)
    const task = 'tacheWan' + String(++n).padStart(6, '0'); etat[task] = { state: 'generating' }
    return Response.json({ code: 200, data: { taskId: task } })
  }
  if (s.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo')) {
    const t = new URL(s).searchParams.get('taskId') || ''
    const e = etat[t]; if (!e) return Response.json({ code: 404, msg: 'record not found' })
    return Response.json({ code: 200, data: { taskId: t, state: e.state, failMsg: e.failMsg || '', failCode: e.failCode || '', param: '' } })
  }
  throw new Error('réseau interdit dans le banc : ' + s + ' ' + (o?.method || 'GET'))
}) as typeof fetch

const FN = Deno.env.get('FONCTIONS') || new URL('../../supabase/functions', import.meta.url).pathname
const { handler: kieProxy } = await import('file://' + FN + '/kie-proxy/handler.ts')
await import('file://' + FN + '/mcp/index.ts')
const mcp = (globalThis as any).__handler as (r: Request) => Promise<Response>

// ── Comptes ──
const PRO = '11111111-2222-4333-8444-555555555555', OWNER = '22222222-2222-4333-8444-555555555555', DEV = '33333333-2222-4333-8444-555555555555'
const tok: Record<string, string> = { [PRO]: 'jwt-pro', [OWNER]: 'jwt-owner', [DEV]: 'jwt-dev' }
const remb: { action: string; task: string }[] = []
function base() {
  for (const k of Object.keys(db.t)) delete db.t[k]
  st.o.clear(); logs = []; envois.length = 0; remb.length = 0
  db.tokens = { 'jwt-pro': { id: PRO }, 'jwt-owner': { id: OWNER }, 'jwt-dev': { id: DEV } }
  db.rows('profiles').push({ id: PRO, plan: 'pro', is_owner: false, credits_remaining: 500, bought_credits: 0 },
    { id: OWNER, plan: 'pro', is_owner: true, credits_remaining: 0, bought_credits: 0 }, { id: DEV, plan: 'developer', is_owner: false, credits_remaining: 0, bought_credits: 0 })
  Object.assign(db.rpcs, rpcsCreditsMcp(db), {
    rate_hit: () => true, has_recent_debit: () => true, resolve_op: () => 'op-wan-1', draw_reservation: () => 0,
    // modèle minimal de kie_job_bill (20260925…) : release puis refund d'une tâche tirée
    kie_job_bill: (a: any) => {
      const j = db.rows('kie_jobs').find((r) => r.task_id === a.p_task && r.user_id === a.p_user); if (!j || !j.op_id) return { ok: false, reason: 'not_drawn' }
      remb.push({ action: a.p_action, task: a.p_task })
      j.bill_state = a.p_action === 'refund' ? 'refunded' : a.p_action === 'release' ? 'released' : 'settled'
      return { ok: true, bill: j.bill_state }
    },
  })
  for (const u of [PRO, OWNER, DEV]) { st.put('render-media', `${u}/dc-cut-1.mp4`, REF); st.put('render-media', `${u}/perso.jpg`, new Uint8Array(900), 'image/jpeg') }
}
const wan = (u: string) => kieProxy(new Request(`${BASE}/functions/v1/kie-proxy?path=/kie/wan-3`, { method: 'POST', headers: { authorization: 'Bearer ' + tok[u], 'content-type': 'application/json', 'x-aa-op': 'op-wan-1' },
  body: JSON.stringify({ video_url: signeSupabase(BASE, 'render-media', `${u}/dc-cut-1.mp4`), image_url: signeSupabase(BASE, 'render-media', `${u}/perso.jpg`), duration: 5, resolution: '720P', aspect_ratio: 'adaptive', audio: false, nsfw_checker: false }) }))

const res: [string, boolean][] = []
const ok = (nom: string, c: boolean, d = '') => { res.push([nom, c]); keep((c ? '  ✓ ' : '  ✗ ') + nom + (c ? '' : ' — ' + d + '\n    ' + logs.slice(-4).join('\n    '))) }
const REFUS = 'Input data may contain inappropriate content (NSFW).'

// ── 1. App (kie-proxy) ──
keep('1. Changement de personnage depuis l’app (kie-proxy, alias wan-3)')
for (const [nom, u, attendu] of [['client Pro', PRO, true], ['compte propriétaire', OWNER, true], ['compte developer (tests)', DEV, false]] as const) {
  base()
  const r = await wan(u); const d = await r.json().catch(() => ({}))
  const inp = envois[0]?.input || {}
  ok(`${nom} : filtre explicite ${attendu ? 'ALLUMÉ' : 'coupé'} (nsfw_checker: ${inp.nsfw_checker}), même si le client envoie false`, r.status === 200 && inp.nsfw_checker === attendu, `http=${r.status} ${JSON.stringify(d).slice(0, 160)} nsfw_checker envoyé=${inp.nsfw_checker}`)
}
base()
{
  const r = await wan(PRO); const d = await r.json()
  const task = String(d.request_id || '').replace(/^mk-/, '')
  etat[task] = { state: 'fail', failMsg: REFUS, failCode: 'DataInspectionFailed' }
  const s = await (await kieProxy(new Request(`${BASE}/functions/v1/kie-proxy?path=/kie/requests/mk-${task}/status`, { headers: { authorization: 'Bearer jwt-pro' } }))).json()
  ok('refus du filtre chez kie : tâche en échec, tirage rendu PUIS remboursé (KIE_NO_FALLBACK)', s.status === 'FAILED' && s.billing === 'refunded' && remb.map((x) => x.action).join(',') === 'release,refund', `${JSON.stringify(s)} ${JSON.stringify(remb)}`)
  // phrase montrée par l'app : celle de _dcRun (toast) appliquée au message que _kieRun lui passe (« kie : » retiré par _kieMsg)
  const html = await Deno.readTextFile(Deno.env.get('APP_HTML') || new URL('../../app/index.html', import.meta.url).pathname)
  const ligne = html.split('\n').find((l) => /if\(!\(e && e\._dcSilence\)\) toast\(/.test(l)) || ''
  const expr = ligne.slice(ligne.indexOf('toast(') + 6, ligne.lastIndexOf(');'))
  const aide = (html.match(/function _dcMsgErreur\(m\)\{[\s\S]*?\n\}/) || [''])[0]
  const phrase = String(new Function('m', aide + '\nreturn ' + expr)(String(s.error || '')))
  ok(`l’app traduit le refus en français (« ${phrase.slice(0, 70)}… »)`, !/NSFW|inappropriate|Input data/i.test(phrase) && /refusé/i.test(phrase) && /rendus/i.test(phrase), phrase)
}

// ── 2. Claude (MCP, outil decupler_video) ──
keep('2. Changement de personnage depuis Claude (MCP)')
const N = 5, VAR = Math.ceil(N * 0.5), DUREE = 5, COUT = VAR + DUREE * 10
let jobId = '', prepId = ''
function mcpJob() {
  base()
  jobId = crypto.randomUUID(); prepId = crypto.randomUUID()
  db.rows('render_jobs').push({ id: prepId, user_id: PRO, status: 'done', output_url: `mcp-prep/${PRO}/${prepId}.mp4`, plan: { __compose: 'mc-ref' }, assets: [], avatar_clips: [] })
  st.put('render-media', `mcp-prep/${PRO}/${prepId}.mp4`, REF)
  st.put('mcp-media', `${PRO}/mcp-src/${jobId}-char.jpg`, new Uint8Array(900), 'image/jpeg')
  db.rows('mcp_jobs').push({ id: jobId, user_id: PRO, kind: 'avatar', status: 'running', op_name: 'vn:' + prepId, credits_cost: 0, refunded: false,
    created_at: new Date().toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(),
    params: { video: true, tool: 'decup', n: N, perso: true, alt: {}, text_pos: 'Haut', max_dur: DUREE, char_path: `${PRO}/mcp-src/${jobId}-char.jpg` } })
}
const mj = () => db.rows('mcp_jobs').find((r) => r.id === jobId)!
const statut = async () => { mj().updated_at = new Date(Date.now() - 60_000).toISOString(); return await (await mcp(new Request(`https://mcp.avatarads.fr/mcp/status/${jobId}`))).json() }
mcpJob()
await statut()
ok(`job MCP : filtre explicite ALLUMÉ (nsfw_checker: ${envois[0]?.input?.nsfw_checker})`, envois[0]?.input?.nsfw_checker === true, `op=${mj().op_name} nsfw_checker envoyé=${envois[0]?.input?.nsfw_checker}`)
const task = String(mj().op_name || '').replace(/^dw:/, '')
etat[task] = { state: 'fail', failMsg: REFUS, failCode: 'DataInspectionFailed' }
const s2 = await statut()
const rendu = db.rows('profiles').find((r) => r.id === PRO)!.credits_remaining - (500 - COUT)
ok(`refus du filtre : job en échec, ${COUT} crédits rendus (personnage jamais livré), message « modération »`, s2.status === 'failed' && rendu === COUT && /modération/.test(String(s2.msg)) && !s2.perso, `${JSON.stringify(s2)} rendu=${rendu}`)

const nok = res.filter(([, c]) => !c).length
keep(`\n${res.length - nok}/${res.length} vérifications OK`)
Deno.exit(nok ? 1 : 0)
