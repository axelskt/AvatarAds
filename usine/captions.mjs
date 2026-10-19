#!/usr/bin/env node
// Creative Factory — sous-titres brûlés via HyperFrames (ffmpeg local sans drawtext/libass).
// 3 modes :
//   emit  <audio> <offsetSec> <outWords.json>     → transcrit (Whisper large-v3 fr) et écrit les MOTS (start/end + offset)
//   burn  <video> <output> <words.json> [opts.json] → brûle des mots déjà prêts (ex. captions-manifest exactes)
//   (legacy) <video> <output> [audioBrique] [offset] [voiceStart]  → transcrit PUIS brûle (compat)
// Principe usine : une brique connaît ses mots (manifest) → 0 erreur ; seules les démos passent par Whisper.
// opts.json (FORMATS DE HOOK, usine/formats.js, écrit par build.mjs) :
//   { subs: 'normal' | 'gros-colores' | 'aucun',
//     choc: { text, end, layout } }  → phrase choc visible DÈS LA FRAME 0 (couverture TikTok, jamais blanche) jusqu'à
//     `end` s, placée par chocLayout (zone sûre, jamais sur un visage) ; les sous-titres ne commencent qu'après elle.
//   'normal' = style validé (blanc contour noir 82 px) ; 'gros-colores' = gros mots (108 px), mot fort en jaune.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

await import(new URL('./formats.js', import.meta.url).href);   // globalThis.CF_FORMATS (isStrong, bigCapSize, capsAfterChoc)
const FMT = globalThis.CF_FORMATS;
const HOT = '#FFE14A';   // mot fort des gros sous-titres colorés
const esc = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const EMOJI = /(\p{Extended_Pictographic}(?:\u200d\p{Extended_Pictographic}|\ufe0f)*)/gu;

const LEAD = 0.12;
// 07/10 (test A3, démo SANS voix) : un sous-titre restait affiché jusqu'au mot SUIVANT, donc pendant les 20 s de la démo
// muette, par-dessus ses propres textes. Au-delà de GAP_HOLD s de silence, il disparaît 0,45 s après son dernier mot.
const GAP_HOLD = 1.0;
// CLI HyperFrames : npx sur le Mac ; sur le serveur (Railway) le binaire installé dans l'image (CF_HF_BIN)
const HF = process.env.CF_HF_BIN || 'npx', HF_PRE = process.env.CF_HF_BIN ? [] : ['--yes', 'hyperframes'];
const bareOf = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
// emoji Apple HD : binaire compilé une fois depuis usine/emoji-render.swift (macOS + swiftc), null sinon
let _emojiBin;
function emojiRenderer() {
  if (_emojiBin !== undefined) return _emojiBin;
  const src = decodeURIComponent(new URL('./emoji-render.swift', import.meta.url).pathname), dir = join(homedir(), '.cache', 'cf-emoji'), bin = join(dir, 'emoji-render');
  try { if (!existsSync(bin)) { mkdirSync(dir, { recursive: true }); execFileSync('swiftc', ['-O', src, '-o', bin], { timeout: 180000 }); } _emojiBin = existsSync(bin) ? bin : null; }
  catch { _emojiBin = null; }
  return _emojiBin;
}
const brandFix = t => { const b=bareOf(t); if(/atarhat|avatarad|atarad|avatarhat|avataraad|avatahad|avatarhad|avataad|avataradi|avatarhds/.test(b))   // Axel 12/10 : « AVATAHADS.FR »
    return (/fr$/.test(b)||/\.?fr\b/i.test(t))?'avatarads.fr':'avatarads'; return t; };

function transcribeWords(audio, offset) {
  const work = mkdtempSync(join(tmpdir(), 'caps-tr-'));
  execFileSync('ffmpeg', ['-v','error','-y','-i', audio, '-vn','-ac','1','-ar','16000', join(work,'audio.wav')]);
  execFileSync(HF, [...HF_PRE,'transcribe', join(work,'audio.wav'), '-d', work, '--json','--model','large-v3','--language','fr','--timeout','300000'], { stdio:'inherit' });
  const tr = JSON.parse(readFileSync(join(work,'transcript.json'),'utf8'));
  return (Array.isArray(tr) ? tr : (tr.words||tr.segments||[]))
    .map(w => ({ text:String(w.text||w.word||'').trim(), start:+w.start + offset, end:+w.end + offset }))
    .filter(w => w.text && isFinite(w.start) && isFinite(w.end) && w.end>w.start);
}

// mots (start/end absolus) → captions continues + lead + fix marque → HTML → rendu
function burn(video, output, words, opts = {}) {
  output = resolve(output);   // HyperFrames rend depuis le dossier de travail : un chemin relatif y atterrirait
  const subs = ['normal', 'gros-colores', 'aucun'].includes(opts.subs) ? opts.subs : 'normal';
  const choc = opts.choc && opts.choc.text && opts.choc.layout && opts.choc.end > 0 ? opts.choc : null;
  const work = mkdtempSync(join(tmpdir(), 'caps-'));
  const dur = parseFloat(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', video]).toString().trim());
  copyFileSync(video, join(work, 'src.mp4'));
  // B-roll en CARTE (Axel 29/09 : « pas en plein écran ») : image / vidéo arrondie, bordure blanche, centrée sur le visage,
  // arrive en pop et repart en fondu ; la voix continue dessous (vidéo muette)
  // Axel 19/10 (VF-0658, 0672, 0690, 0696, 0726) : un texte choc À LOGOS (TH27 / TH36) est un gros bloc (~350 px) qui recouvrait
  // l'illustration du hook (l'influenceur caché derrière « = 💸💸💸 », les logos posés au milieu des cartes). Pendant le texte
  // à logos, l'illustration se cale dans la plus grande bande LIBRE (au-dessus ou au-dessous du bloc, hors sous-titres) et
  // réduit au besoin en gardant son format : le bloc et l'illustration ne se touchent plus jamais.
  const LB = choc && choc.layout.logos ? choc.layout : null;
  const fitLogos = b => {
    if (!LB || !(b.style === 'hook' || b.pair) || b.at >= choc.end) return b;
    const spans = [[250, LB.y - 30], [LB.y + LB.h + 30, 1290]].map(([a, z]) => [a, z, z - a]).sort((p, q) => q[2] - p[2]);
    const [a, z, h] = spans[0], sc = Math.min(1, h / b.H);
    return { ...b, W: Math.round(b.W * sc), H: Math.round(b.H * sc), cy: Math.round((a + z) / 2) };
  };
  const broll = (Array.isArray(opts.broll) ? opts.broll : []).filter(b => b && b.file && b.dur > 0.2).map((b, k) => {
    const ext = (b.file.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase(), name = 'broll' + k + ext;
    copyFileSync(b.file, join(work, name));
    // carte au format du média (plus de bandes blanches autour d'une image) : largeur 460, hauteur ≤ 760
    let ar = 9 / 16; try { const [w, h] = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0', b.file]).toString().trim().split(',').map(Number); if (w && h) ar = w / h; } catch {}
    // carte au format EXACT du média : si la hauteur est plafonnée, la largeur suit (VF-0017 : static ad 9:16 coupée en haut)
    const Wmax = b.style === 'hook' ? 720 : 460, Hmax = b.style === 'hook' ? 1040 : 760;
    const H = Math.min(Hmax, Math.round(Wmax / ar)), W = Math.round(H * ar) > Wmax ? Wmax : Math.round(H * ar);
    // 13/10 (Axel) : avant / après en DEUX cartes séparées d'un petit espace — l'avant entre par la gauche, l'après par la droite
    if (b.pair) { const name2 = 'broll' + k + 'b' + ext; copyFileSync(b.pair, join(work, name2)); return fitLogos({ ...b, name, name2, k, W: 400, H: 711 }); }
    return fitLogos({ ...b, name, k, W, H });
  });
  words = words.slice().sort((a,b)=>a.start-b.start);
  // fusion « avatar »+« ads » puis fix marque
  { const merged=[]; for(let i=0;i<words.length;i++){ const w=words[i], n=words[i+1];
      if(n && /^a?v?atar$/.test(bareOf(w.text)) && /^(hat|had|ad|rad|hads|aad)/.test(bareOf(n.text))){
        merged.push({ text:(/fr/.test(bareOf(n.text))||/\.fr/i.test(n.text))?'avatarads.fr':'avatarads', start:w.start, end:n.end }); i++;
      } else merged.push(w);
    } words = merged.map(w=>({ ...w, text:brandFix(w.text) })); }
  // captions continues (pas de trou) + lead, bornées à la vidéo
  // mot à mot, SAUF les mots marqués d'un groupe (w.g, posé par build.mjs) : la phrase s'affiche alors en bloc, chaque mot
  // s'allume quand il est dit (Axel 29/09 : groupes aux moments clés, puis retour au mot à mot)
  // jamais de ponctuation à l'écran (Axel 30/09) : on retire . , ! ? ; : … en début / fin de mot (le point d'un domaine reste)
  const clean = t => t.toUpperCase().replace(/[<>&"«»“”]/g,'').replace(/^[.,!?;:…()'’-]+|[.,!?;:…()]+$/g,'').trim();
  let caps = [];
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    if (w.g) {
      let j = i; while (j < words.length && words[j].g === w.g) j++;
      const grp = words.slice(i, j), next = words[j];
      const last = grp[grp.length - 1].end;
      const s = Math.max(0, w.start - LEAD), e = Math.min(dur, next && next.start - last <= GAP_HOLD ? Math.max(s + 0.3, next.start - LEAD) : last + 0.45);
      // 11/10 : un « ou » isolé (« Écris « site » en commentaire ») devient vide une fois nettoyé → case vide dans les
      // styles en pastilles (S05) ; on ne garde que les mots qui ont du texte
      const vis = grp.map(x => ({ t: clean(x.text), s: Math.max(0, x.start - LEAD) })).filter(x => x.t);
      if (vis.length) caps.push({ grp: vis, t: vis.map(x => x.t).join(' '), s, e });
      i = j; continue;
    }
    const next = words[i + 1], s = Math.max(0, w.start - LEAD);
    const e = Math.min(dur, next && next.start - w.end <= GAP_HOLD ? Math.max(s, next.start - LEAD) : w.end + (next ? 0.45 : 0.35));
    caps.push({ t: clean(w.text), s, e }); i++;
  }
  // 11/10 (VF-0109) : le 1er mot calé à 0 par l'avance (LEAD) n'avait plus que 0,03 s (« C'est » dit de 0,03 à 0,15) et le
  // filtre ci-dessous le supprimait → le hook s'ouvrait sur le 2e mot. Il garde 0,12 s, le mot suivant attend.
  for (let k = 0; k + 1 < caps.length; k++) {
    const a = caps[k], b = caps[k + 1];
    if (a.s > 0 || a.grp || b.grp || !a.t || a.e - a.s >= 0.12) continue;
    const ne = Math.min(0.12, b.e - 0.06);
    if (ne > a.e) { a.e = ne; b.s = Math.max(b.s, ne); }
  }
  caps = caps.filter(c => c.e - c.s >= 0.06 && (c.grp || c.t));   // un « isolé devient vide : jamais de sous-titre vide
  // 29/09 (Axel : « il y a le texte mais pas de sous-titres ») : les sous-titres tournent AUSSI pendant la phrase choc
  // (elle est en haut, eux en bas) ; « aucun » = pas de sous-titres
  if (subs === 'aucun') caps = [];
  // hook : frame 0 jamais vide (couverture TikTok) — sans phrase choc, le 1er mot, s'il tombe dans les 0,3 premières s, est là dès 0
  if (!choc && caps.length && caps[0].s < 0.3) caps[0] = { ...caps[0], s: 0 };
  const big = subs === 'gros-colores';

  // frame 0 jamais blanche : un mot qui démarre à 0 est posé tel quel (pas de fondu depuis l'invisible)
  // styles = les 19 de la banque + S21 (Axel 30/09 : « mets les 19 en aléatoire ») ; anciens noms gardés en alias
  const ALIAS = { contour: 'S02', boite: 'S21', bleu: 'S03', rouge: 'S07', white: 'S10', neon: 'S12' };
  const sid = ALIAS[opts.style] || (/^S\d{2}$/.test(opts.style || '') ? opts.style : 'S02');
  const box = ['S03', 'S05', 'S07', 'S21'].includes(sid);
  const stCls = 'st-' + sid;
  const clipsHtml = caps.map((c,i)=>{
    if (c.grp && box) return `<div class="cap clip grp bx" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">`
      + c.grp.map((x, k) => `<span class="gw" id="c${i}w${k}">${x.t}</span>`).join(' ') + `</div>`;
    if (box && !c.grp) return `<div class="cap clip bx" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}"><span class="bw">${c.t}</span></div>`;
    if (c.grp) return `<div class="cap clip grp" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}">`
      + c.grp.map((x, k) => `<span class="gw" id="c${i}w${k}">${x.t}</span>`).join(' ') + `</div>`;
    const cls = 'cap clip' + (big ? ' big' + (FMT.isStrong(c.t) ? ' hot' : '') : '');
    const st = big ? ` style="font-size:${FMT.bigCapSize(c.t, 800, 68, 44)}px"` : '';   // 800 = largeur de la zone sûre ; 68 px au plus (Axel 18/10)
    return `<div class="${cls}" id="c${i}" data-start="${c.s.toFixed(3)}" data-duration="${(c.e-c.s).toFixed(3)}"${st}>${c.t}</div>`;
  }).join('\n      ');
  const anim = caps.map((c,i)=> c.grp
    // groupe (Axel 29/09) : les mots arrivent UN PAR UN quand ils sont dits, chacun monte du bas et se pose, et la phrase
    // se construit ; elle reste entière jusqu'au mot suivant le groupe
    ? `tl.set('#c${i}',{autoAlpha:1}, ${c.s.toFixed(3)});`
      + c.grp.map((x, k) => `tl.fromTo('#c${i}w${k}',{opacity:0,y:46},{opacity:1,y:0,duration:0.24,ease:'power3.out'}, ${Math.max(c.s, x.s).toFixed(3)});`).join('')
    : c.s < 0.02 ? `tl.set('#c${i}',{autoAlpha:1,y:0,scale:1}, 0);`
    : big ? `tl.fromTo('#c${i}',{autoAlpha:0,scale:0.82},{autoAlpha:1,scale:1,duration:0.1,ease:'back.out(2.2)'}, ${c.s.toFixed(3)});`
    : `tl.fromTo('#c${i}',{autoAlpha:0,y:10},{autoAlpha:1,y:0,duration:0.09,ease:'power1.out'}, ${c.s.toFixed(3)});`).join('\n      ');
  let chocHtml = '', chocAnim = '';
  if (choc) {
    const L = choc.layout, end = Math.min(choc.end, dur);
    // emojis APPLE (Axel 30/09 : « bien prendre ceux d'Apple ») : image officielle (emoji-datasource-apple, 64 px) posée
    // dans le texte ; si le téléchargement échoue, repli sur la police Noto
    // Axel 12/10 : « les émojis sont flous » (64 px agrandis) → d'abord l'emoji Apple dessiné en 256 px par usine/emoji-render.swift
    // (police du Mac, compilé une fois, cache ~/.cache/cf-emoji) ; repli sur l'image 64 px puis sur la police Noto
    const appleEmoji = e => {
      const cps = [...e].map(c => c.codePointAt(0).toString(16)), names = [cps.join('-'), cps.filter(c => c !== 'fe0f').join('-')];
      try {
        const bin = emojiRenderer(), cache = join(homedir(), '.cache', 'cf-emoji'), hi = join(cache, names[0] + '-256.png');
        if (bin && !existsSync(hi)) { mkdirSync(cache, { recursive: true }); execFileSync(bin, [e, '256', hi], { timeout: 20000 }); }
        if (existsSync(hi)) { const f = 'emj-' + names[0] + '-hd.png'; copyFileSync(hi, join(work, f)); return f; }
      } catch { /* repli 64 px */ }
      for (const n of names) {
        const f = 'emj-' + n + '.png';
        try { execFileSync('curl', ['-sf', '-o', join(work, f), 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple@15.1.2/img/apple/64/' + n + '.png']); return f; } catch { /* nom suivant */ }
      }
      return null;
    };
    const line = l => esc(l).replace(EMOJI, m => { const f = appleEmoji(m); return f ? `<img class="emj" src="${f}" alt="">` : `<span class="em">${m}</span>`; });
    const cs = /^CS\d{2}$/.test(String(choc.style || '')) ? choc.style : 'CS01';   // style du texte choc (Axel 01/10, 11 styles validés)
    if (L.logos === 'cheat') {   // TH36 (Axel 18/10) : [Claude] + [AvatarAds] = 🔥, puis la phrase dans un bandeau blanc natif
      const T = decodeURIComponent(new URL('../render-worker/assets/tuto/', import.meta.url).pathname);
      // Axel 19/10 : « supprime le fond blanc du logo Claude » → le carré de render-worker avait des coins BLANCS opaques (liseré
      // blanc autour du carré orange) ; version nettoyée (coins transparents, étoile intacte) rangée dans usine/assets.
      copyFileSync(decodeURIComponent(new URL('./assets/logo-claude-carre.png', import.meta.url).pathname), join(work, 'lg-claude-sq.png')); copyFileSync(join(T, 'logo-avatarads.png'), join(work, 'lg-aa.png'));
      const ff = appleEmoji('🔥'), fire = ff ? `<img class="fire" src="${ff}" alt="">` : '<span class="em fire">🔥</span>';
      chocHtml = `<div class="choc clip choc-cheat" id="choc" data-start="0" data-duration="${end.toFixed(3)}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px;`
        + `--lg:${L.logo}px;--gap:${L.gap}px;--fs:${L.size}px">`
        + `<div class="cr1"><img class="lg" src="lg-claude-sq.png" alt=""><span class="op">+</span><img class="lg" src="lg-aa.png" alt=""><span class="op">=</span>${fire}</div>`
        + `<div class="cr2"><span>${esc('Cheat code pour générer des pubs')}</span></div></div>`;
    } else if (L.logos) {   // TH27 (Axel 12/10) : logos officiels AvatarAds + Claude en gros, « = 💸💸💸 » dessous, sans bandeau
      const T = decodeURIComponent(new URL('../render-worker/assets/tuto/', import.meta.url).pathname);
      copyFileSync(join(T, 'logo-avatarads.png'), join(work, 'lg-aa.png')); copyFileSync(join(T, 'logo-claude.png'), join(work, 'lg-claude.png'));
      // Axel 12/10 : « les émojis argent sont à moitié flous » → l'image 64 px agrandie ×2 ; emoji Apple rendu une fois en 320 px
      copyFileSync(join(T, 'emoji-money-320.png'), join(work, 'lg-money.png'));
      const money = '<img class="emj" src="lg-money.png" alt="">'.repeat(3);
      chocHtml = `<div class="choc clip choc-logos" id="choc" data-start="0" data-duration="${end.toFixed(3)}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px;`
        + `--lg:${L.logo}px;--gap:${L.gap}px;font-size:${L.size}px;line-height:${L.lineH}px">`
        + `<div class="lg1"><img src="lg-aa.png" alt=""><span>+</span><img class="lgc" src="lg-claude.png" alt=""></div><div class="lg2"><span>=</span>${money}</div></div>`;
    } else
    chocHtml = `<div class="choc clip cs-${cs}" id="choc" data-start="0" data-duration="${end.toFixed(3)}" data-maxw="${L.maxW}" style="left:${L.x}px;top:${L.y}px;width:${L.w}px;`
      + `--jc:${L.align === 'left' ? 'flex-start' : 'center'};font-size:${L.size}px;line-height:${L.lineH}px;--px:${L.padX}px;--py:${L.padY}px">`
      + L.lines.map(l => `<div class="cl"><span>${line(l)}</span></div>`).join('') + `</div>`;
    // visible pleine opacité dès 0 (couverture) ; sortie courte juste avant la fin
    chocAnim = `tl.set('#choc',{autoAlpha:1,scale:1}, 0);\n      tl.to('#choc',{autoAlpha:0,scale:0.96,duration:0.16,ease:'power1.in'}, ${Math.max(0, end - 0.16).toFixed(3)});`;
  }
  const cardStyle = b => `style="left:${540 - b.W / 2}px;top:${Math.round((b.cy || 800) - b.H / 2)}px;width:${b.W}px;height:${b.H}px"`;
  const GAP = 28;   // espace entre les deux cartes d'un avant / après
  const pairStyle = (b, side) => `style="left:${side ? 540 + GAP / 2 : 540 - GAP / 2 - b.W}px;top:${Math.round((b.cy || 800) - b.H / 2)}px;width:${b.W}px;height:${b.H}px"`;
  const brollHtml = broll.map(b => b.pair
    ? `<video class="broll clip" id="br${b.k}" src="${b.name}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${pairStyle(b, 0)} muted playsinline></video>`
      + `\n      <video class="broll clip" id="br${b.k}b" src="${b.name2}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${pairStyle(b, 1)} muted playsinline></video>`
    : b.image
    ? `<img class="broll clip" id="br${b.k}" src="${b.name}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${cardStyle(b)} alt="">`
    : `<video class="broll clip" id="br${b.k}" src="${b.name}" data-start="${b.at.toFixed(3)}" data-duration="${b.dur.toFixed(3)}" ${cardStyle(b)} muted playsinline></video>`).join('\n      ');
  // 1re carte : pop au centre ; chaque carte suivante arrive par la droite pendant que la précédente se pousse à gauche
  // (les deux restent à l'écran, côte à côte) ; toutes repartent ensemble à la fin
  const brollAnim = broll.map((b, i) => {
    // illustration du hook : entre par la droite, repart par la gauche
    // avant / après en deux cartes : la gauche arrive de la gauche, la droite de la droite (léger décalage), et repartent chacune de leur côté
    if (b.pair) { const out = Math.max(b.at + 0.4, b.at + b.dur - 0.3).toFixed(3);
      return `tl.fromTo('#br${b.k}',{autoAlpha:1,x:-1100},{x:0,duration:0.36,ease:'power3.out'}, ${b.at.toFixed(3)});`
        + `tl.fromTo('#br${b.k}b',{autoAlpha:1,x:1100},{x:0,duration:0.36,ease:'power3.out'}, ${(b.at + 0.07).toFixed(3)});`
        + `tl.to('#br${b.k}',{x:-1100,duration:0.3,ease:'power3.in'}, ${out});tl.to('#br${b.k}b',{x:1100,duration:0.3,ease:'power3.in'}, ${out});`; }
    if (b.style === 'hook') return `tl.fromTo('#br${b.k}',{autoAlpha:1,x:1100},{x:0,duration:0.34,ease:'power3.out'}, ${b.at.toFixed(3)});`
      + `tl.to('#br${b.k}',{x:-1100,duration:0.3,ease:'power3.in'}, ${Math.max(b.at + 0.4, b.at + b.dur - 0.3).toFixed(3)});`;
    const prevs = broll.slice(0, i).filter(x => x.style !== 'hook');
    let a = !prevs.length
      ? `tl.fromTo('#br${b.k}',{autoAlpha:0,scale:0.7,y:40},{autoAlpha:1,scale:1,y:0,duration:0.28,ease:'back.out(1.8)'}, ${b.at.toFixed(3)});`
      : `tl.fromTo('#br${b.k}',{autoAlpha:0,x:560,scale:0.82},{autoAlpha:1,x:250,scale:0.82,duration:0.38,ease:'power3.out'}, ${b.at.toFixed(3)});`
        + `tl.to('#br${prevs[prevs.length - 1].k}',{x:-250,scale:0.82,duration:0.38,ease:'power3.inOut'}, ${b.at.toFixed(3)});`;
    a += `tl.to('#br${b.k}',{autoAlpha:0,scale:0.78,duration:0.18,ease:'power1.in'}, ${Math.max(b.at, b.at + b.dur - 0.18).toFixed(3)});`;
    return a;
  }).join('\n   ');
  const html = `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<style>
 body{margin:0;background:#000}
 #root{position:relative;width:1080px;height:1920px;overflow:hidden;background:#000;font-family:'Arial Black','Archivo Black',system-ui,sans-serif}
 #bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
 /* ZONE SÛRE (Axel 07/10, capture TikTok : « ça touche l'icône commentaire, les sous-titres sont trop gros ») :
    800 px de large, bas du texte au-dessus de 1 470 px (légende) ; un mot ou une ligne plus large que 800 px est réduit
    (script plus bas), jamais coupé ni débordant. Axel 11/10 : « mal centré, + sur la droite » → bande CENTRÉE sur
    l'image (x 140 → 940, axe à 540) au lieu de x 80 → 880 (axe à 480, 60 px trop à gauche) ; les mots courts restent
    loin des icônes, seul un mot de 800 px frôle la colonne de droite */
 /* Axel 12/10 : « ça sert à rien de faire les sous-titres trop gros » → tout réduit (base 82 → 70, Anton 96-98 → 72, gros 108 → 90)
    Axel 18/10 (captures TikTok) : « nos sous-titres sont beaucoup trop gros » → encore −25 % (base 54, Anton 56, gros 68 ;
    les gros passaient en réalité à 108 px : la taille venait de bigCapSize, plus du CSS) */
 .cap{position:absolute;left:140px;width:800px;bottom:450px;z-index:5;text-align:center;
   font-weight:900;font-size:54px;letter-spacing:.005em;color:#fff;text-transform:uppercase;
   -webkit-text-stroke:6px #000;paint-order:stroke fill;
   text-shadow:0 5px 16px rgba(0,0,0,.5);white-space:nowrap;line-height:1}
 /* gros sous-titres colorés : même bande basse, mot fort en jaune */
 .cap.big{bottom:450px;font-size:68px;-webkit-text-stroke:7px #000;text-shadow:0 6px 18px rgba(0,0,0,.55)}
 /* groupe de sous-titres (moments clés) : la phrase en bloc sur 2-3 lignes, chaque mot s'allume quand il est dit */
 .broll{position:absolute;z-index:4;object-fit:cover;border-radius:34px;border:5px solid #fff;box-shadow:0 22px 60px rgba(0,0,0,.45);background:transparent}
 .cap.grp{white-space:normal;font-size:50px;line-height:1.1;-webkit-text-stroke:6px #000}
 .cap.grp .gw{display:inline-block;opacity:0}
 /* style « boite » : texte noir sur pastille blanche arrondie, sans contour */
 .cap.bx{-webkit-text-stroke:0;text-shadow:none;color:#111;font-size:50px}
 .cap.bx .bw,.cap.bx.grp .gw{background:#fff;border-radius:13px;padding:5px 15px 6px;box-shadow:0 8px 24px rgba(0,0,0,.28);line-height:1.15}
 .cap.bx.grp{font-size:48px;line-height:1.45}
 .cap.bx.grp .gw{margin:0 2px}
 .st-S03 .cap.bx,.st-S07 .cap.bx,.st-S05 .cap.bx{color:#fff}
 .st-S03 .cap.bx .bw,.st-S03 .cap.bx.grp .gw{background:#1d6bff}
 .st-S07 .cap.bx .bw,.st-S07 .cap.bx.grp .gw{background:#e11d2e}
 .st-S05 .cap.bx .bw,.st-S05 .cap.bx.grp .gw{background:#ff2d8a;border-radius:40px}
 .st-S05 .cap.bx.grp .gw:nth-child(even){background:#ffe600;color:#111}
 .st-S01 .cap{font-family:'Anton',sans-serif;font-weight:400;font-size:56px;letter-spacing:.02em;-webkit-text-stroke:3px #000}
 .st-S04 .cap{color:#e9fff0;-webkit-text-stroke:2px #0b2a14;text-shadow:0 0 16px #39ff88,0 0 40px #8a4dff,0 4px 12px rgba(0,0,0,.5)}
 .st-S06 .cap{font-family:'Anton',sans-serif;font-weight:400;font-size:56px;color:#ffe600;-webkit-text-stroke:6px #000}
 .st-S08 .cap{font-size:54px;-webkit-text-stroke:6px #000}
 .st-S09 .cap{font-family:'Inter',sans-serif;font-weight:800;text-transform:none;-webkit-text-stroke:0;font-size:56px;text-shadow:0 3px 16px rgba(0,0,0,.8)}
 .st-S10 .cap{-webkit-text-stroke:0;text-shadow:0 4px 18px rgba(0,0,0,.75),0 1px 3px rgba(0,0,0,.6)}
 .st-S11 .cap{font-size:54px;color:#ff6a1a;-webkit-text-stroke:5px #000}
 .st-S12 .cap{-webkit-text-stroke:3px #2a0a1c;text-shadow:0 0 18px #ff3da6,0 0 42px rgba(255,61,166,.75),0 4px 14px rgba(0,0,0,.5)}
 .st-S13 .cap{font-family:'Inter',sans-serif;font-weight:600;text-transform:none;-webkit-text-stroke:0;font-size:50px;letter-spacing:0;text-shadow:0 2px 12px rgba(0,0,0,.85)}
 .st-S14 .cap{font-family:'Playfair Display',serif;font-weight:700;font-style:italic;text-transform:none;-webkit-text-stroke:0;font-size:60px;text-shadow:0 3px 16px rgba(0,0,0,.85)}
 .st-S15 .cap{-webkit-text-stroke:5px #000;text-shadow:4px 5px 0 #ff6a1a}
 .st-S16 .cap{color:#ffe600;-webkit-text-stroke:5px #000;text-shadow:4px 5px 0 #000}
 .st-S17 .cap{-webkit-text-stroke:0;text-shadow:0 0 14px #ff1a1a,0 0 38px rgba(255,26,26,.85),0 3px 10px rgba(0,0,0,.6)}
 .st-S18 .cap{font-family:'Anton',sans-serif;font-weight:400;font-size:56px;color:#ffd24a;-webkit-text-stroke:4px #7a0c0c;text-shadow:0 4px 0 #b3121a,0 8px 18px rgba(0,0,0,.5)}
 .st-S19 .cap{font-family:'Montserrat',sans-serif;font-weight:900;color:#ffe600;-webkit-text-stroke:6px #000}
 /* phrase choc : texte « natif » TikTok, bandeau blanc par ligne, placée par chocLayout (zone sûre, hors visage) */
 .choc{position:absolute;z-index:6;font-family:'Inter',sans-serif;font-weight:700;color:#111;transform-origin:50% 50%}
 .choc .cl{display:flex;justify-content:var(--jc,center);margin:0}
 .choc .cl>span{display:inline-block;background:#fff;border-radius:14px;padding:var(--py) var(--px);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.18)}
 /* emoji : Noto Color Emoji (police Google, embarquée par HyperFrames) — JAMAIS Apple Color Emoji (183 Mo embarqués → rendu à court de mémoire) */
 .choc .em{font-family:'Noto Color Emoji',sans-serif;font-weight:400}
 .choc .emj{height:1.08em;width:auto;vertical-align:-0.2em;margin-left:.12em}
 /* TH27 : 2 logos + « = 💸💸💸 » (Axel 12/10 : logos en gros, sans encadré, le « = » dessous) */
 .choc-logos{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:var(--gap);font-family:'Arial Black','Archivo Black',sans-serif;font-weight:900;color:#fff;-webkit-text-stroke:.07em #000;paint-order:stroke fill;filter:drop-shadow(0 10px 24px rgba(0,0,0,.55))}
 .choc-logos .lg1,.choc-logos .lg2{display:flex;align-items:center;justify-content:center;gap:calc(var(--lg) * .2)}
 .choc-logos .lg1{font-size:calc(var(--lg) * .6);line-height:1}
 .choc-logos .lg1 img{width:var(--lg);height:var(--lg);border-radius:calc(var(--lg) * .22);display:block}
 .choc-logos .lg1 img.lgc{transform:scale(1.3)}
 .choc-logos .lg2{font-size:calc(var(--lg) * .55);line-height:1;gap:calc(var(--lg) * .06)}
 .choc-logos .lg2 .emj{height:1.15em;margin-left:0;vertical-align:middle}
 /* TH36 : réf. TikTok au 1:1 (Axel 18/10) — logos 231 px, « + » / « = » blancs, 🔥 176 px, bandeau blanc arrondi texte noir Inter 700 */
 .choc-cheat{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:var(--gap)}
 .choc-cheat .cr1{display:flex;align-items:center;justify-content:center;gap:calc(var(--lg) * .17)}
 .choc-cheat .cr1 img.lg{width:var(--lg);height:var(--lg);display:block;filter:drop-shadow(0 6px 16px rgba(0,0,0,.35))}
 .choc-cheat .op{color:#fff;font-family:'Inter',sans-serif;font-weight:800;font-size:calc(var(--lg) * .26);line-height:1;text-shadow:0 2px 8px rgba(0,0,0,.45)}
 .choc-cheat .fire{height:calc(var(--lg) * .76);width:auto;display:block;margin-left:calc(var(--lg) * -.06)}
 .choc-cheat .em.fire{font-family:'Noto Color Emoji',sans-serif;font-size:calc(var(--lg) * .62);line-height:1}
 .choc-cheat .cr2{display:flex;justify-content:center}
 .choc-cheat .cr2>span{display:inline-block;background:#fff;color:#000;font-family:'Inter',sans-serif;font-weight:700;font-size:var(--fs);line-height:1.1;
   padding:calc(var(--fs) * .5) calc(var(--fs) * .45);border-radius:calc(var(--fs) * .3);white-space:nowrap}
 /* 11 styles de texte choc validés par Axel le 01/10 (planche CS01-CS15 ; refusés : CS04 orange, CS09 carte unique,
    CS12 dégradé, CS14 sticker penché, CS06 néon rouge ; JAMAIS de jaune ; CS16 = surligneur rouge ajouté). CS01 = la base ci-dessus (bandeau blanc natif TikTok). */
 .cs-CS02 .cl>span{background:#111;color:#fff}
 .cs-CS03 .cl>span{background:#E8261C;color:#fff;font-weight:800}
 .cs-CS05{font-family:'Montserrat',sans-serif;font-weight:900;color:#fff}
 .cs-CS05 .cl>span{background:none;box-shadow:none;-webkit-text-stroke:.14em #000;paint-order:stroke fill;padding:0 .1em}
 .cs-CS07{color:#fff;font-weight:800}
 .cs-CS07 .cl>span{background:rgba(255,255,255,.22);border:2px solid rgba(255,255,255,.45);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);text-shadow:0 2px 8px rgba(0,0,0,.35)}
 .cs-CS08{color:#fff;font-weight:600}
 .cs-CS08 .cl>span{background:#0A84FF;border-radius:.62em}
 .cs-CS08 .cl:last-child>span{border-bottom-right-radius:.12em}
 .cs-CS10{font-weight:900;color:#fff;text-shadow:0 3px 10px rgba(0,0,0,.55)}
 .cs-CS10 .cl>span{background:linear-gradient(transparent 52%,#1FCB6A 52%,#1FCB6A 90%,transparent 90%);box-shadow:none;border-radius:0}
 .cs-CS11{font-family:'Anton',sans-serif;font-weight:400;color:#fff;letter-spacing:.01em;text-transform:uppercase}
 .cs-CS11 .cl>span{background:none;box-shadow:none;text-shadow:.07em .07em 0 #000}
 .cs-CS13{font-family:'Courier Prime',monospace;font-weight:700}
 .cs-CS13 .cl>span{border-radius:14px;box-shadow:0 3px 0 #111}
 .cs-CS16{font-weight:900;color:#fff;text-shadow:0 3px 10px rgba(0,0,0,.55)}
 .cs-CS16 .cl>span{background:linear-gradient(transparent 52%,#E8261C 52%,#E8261C 90%,transparent 90%);box-shadow:none;border-radius:0}
 /* CS17 Snapchat (Axel 01/10) : bandeau noir translucide PLEINE LARGEUR, texte blanc qui se ré-enchaîne en 1-2 lignes */
 .cs-CS17{left:0!important;width:1080px!important;background:rgba(0,0,0,.6);color:#fff;font-family:'Inter',sans-serif;font-weight:500;font-size:58px!important;line-height:72px!important;padding:14px 40px;box-sizing:border-box;text-align:center}
 .cs-CS17 .cl{display:inline}
 .cs-CS17 .cl>span{display:inline;background:none;box-shadow:none;border-radius:0;padding:0;white-space:normal}
 .cs-CS17 .cl:not(:last-child)>span::after{content:' '}
 .cs-CS15{font-weight:800;color:#fff}
 .cs-CS15 .cl>span{background:#111;border-left:.22em solid #E8261C;border-radius:4px}
</style></head><body>
 <div id="root" class="${stCls}" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="${dur.toFixed(3)}">
   <video id="bg" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" muted playsinline></video>
   <audio id="au" src="src.mp4" data-start="0" data-duration="${dur.toFixed(3)}" data-volume="1"></audio>
      ${brollHtml}
      ${clipsHtml}
      ${chocHtml}
 </div>
 <script>
   // filet de sécurité : une ligne de la phrase choc plus large que prévu → police réduite (jamais hors de sa boîte),
   // mesurée une fois les polices chargées (toujours depuis la taille prévue)
   (function(){ const c=document.getElementById('choc'); if(!c || c.classList.contains('cs-CS17')) return;   // Snapchat : taille fixe, le texte se ré-enchaîne
     // (07/10 : cette déclaration était collée derrière le commentaire → « fs0 is not defined », filet jamais exécuté)
     const max=+c.dataset.maxw||0, fs0=parseFloat(c.style.fontSize), lh0=parseFloat(c.style.lineHeight);
     const fit=()=>{ c.style.fontSize=fs0+'px'; c.style.lineHeight=lh0+'px'; let w=0;
       c.querySelectorAll('.cl>span').forEach(s=>{ w=Math.max(w, s.getBoundingClientRect().width); });
       const pad=parseFloat(getComputedStyle(c).getPropertyValue('--px'))*2||0;
       if(max && w-pad>max){ const k=max/(w-pad); c.style.fontSize=(fs0*k).toFixed(1)+'px'; c.style.lineHeight=(lh0*k).toFixed(1)+'px'; } };
     if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else fit(); })();
   // zone sûre des sous-titres : largeur mesurée hors transformation (offsetWidth / scrollWidth : les entrées GSAP
   // sont à scale 0,82 ou décalées), police réduite au besoin pour ce sous-titre seulement ; tout de suite puis polices prêtes
   (function(){ const fit=()=>document.querySelectorAll('.cap').forEach(c=>{ if(!c.dataset.fs) c.dataset.fs=parseFloat(getComputedStyle(c).fontSize);
       const fs=+c.dataset.fs; c.style.fontSize=fs+'px';
       const w=c.classList.contains('grp') ? Math.max(0, ...Array.from(c.querySelectorAll('.gw'), s=>s.offsetWidth)) : c.scrollWidth;
       if(w>800) c.style.fontSize=(fs*800/w).toFixed(1)+'px'; });
     fit(); if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit); })();
   const tl = gsap.timeline({ paused:true });
   ${chocAnim}
   ${brollAnim}
   ${anim}
   if(!tl.getChildren().length) tl.to({},{duration:${dur.toFixed(3)}});
   window.__timelines['main'] = tl;
 </script>
</body></html>`;
  writeFileSync(join(work,'index.html'), html);
  console.log(`▶ rendu sous-titres (${caps.length} captions, style ${subs}${choc ? ', phrase choc 0-' + Math.min(choc.end, dur).toFixed(2) + ' s' : ''})…`);
  // fps de la vidéo source (build.mjs passe CF_FPS=60) ; images de fond extraites en jpg (plus rapide que png, sans perte visible)
  // dossier temporaire PROPRE à ce rendu (11/10) : le cache d'extraction d'images de HyperFrames (≈ 1 Go par rendu 60 i/s)
  // vit dans TMPDIR. Il était partagé et vidé à la fin de chaque rendu → avec plusieurs montages en parallèle, le premier
  // qui finissait effaçait les images des autres (« ENOENT … frame_01119.jpg »). Ici il part avec le dossier de travail.
  const hfTmp = join(work, 'tmp'); mkdirSync(hfTmp, { recursive: true });
  execFileSync(HF, [...HF_PRE,'render','--output', output, '--fps', String(process.env.CF_FPS || 30), '--quality', 'delivery', '--video-frame-format', 'jpg', '--workers', String(process.env.CF_WORKERS || 2), '--no-low-memory-mode'], { cwd: work, stdio:'inherit', env:{...process.env, TMPDIR: hfTmp, ...(process.platform === 'darwin' ? { PRODUCER_BROWSER_GPU_MODE:'hardware' } : {})} });
  console.log('OK ->', output);
  try { rmSync(work, { recursive: true, force: true }); } catch { /* sans gravité */ }
}

// ── CLI ──
const argv = process.argv.slice(2);
const mode = (argv[0]==='emit'||argv[0]==='burn') ? argv.shift() : 'legacy';
if (mode === 'emit') {
  const [audio, offsetArg, outJson] = argv;
  if (!audio || !outJson) { console.error('usage: captions.mjs emit <audio> <offsetSec> <out.json>'); process.exit(1); }
  console.log('▶ transcription FR (émission mots)…');
  const words = transcribeWords(audio, parseFloat(offsetArg||'0')||0);
  writeFileSync(outJson, JSON.stringify(words));
  console.log(`  ${words.length} mots -> ${outJson}`);
} else if (mode === 'burn') {
  const [video, output, wordsJson, optsJson] = argv;
  if (!video || !output || !wordsJson) { console.error('usage: captions.mjs burn <video> <output> <words.json> [opts.json]'); process.exit(1); }
  burn(video, output, JSON.parse(readFileSync(wordsJson,'utf8')), optsJson ? JSON.parse(readFileSync(optsJson,'utf8')) : {});
} else {
  const [video, output, audioBrique, offsetArg, voiceStartArg] = argv;
  if (!video || !output) { console.error('usage: captions.mjs <video> <output> [audioBrique] [offset] [voiceStart]'); process.exit(1); }
  const OFFSET = parseFloat(offsetArg||'0')||0, VS = Math.max(0, parseFloat(voiceStartArg||'0')||0);
  console.log('▶ transcription FR (' + (audioBrique ? 'brique' : 'vidéo') + ')…');
  const words = transcribeWords(audioBrique || video, OFFSET).filter(w => w.start >= VS - 0.15);
  burn(video, output, words);
}
