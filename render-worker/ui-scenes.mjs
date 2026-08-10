// ─────────────────────────────────────────────────────────────────────────────
// SCÈNES UI VECTORIELLES du moteur Dynamique — le « wow » des références.
//
// Les vidéos modèles d'Axel ne montrent pas des captures figées : elles
// REDESSINENT l'interface en flat design et l'animent (bouton qui se clique,
// fichier qui glisse, onde qui se compresse). Chaque scène ici couvre une action
// qui revient dans ses 5 scripts (créer un compte, générer/copier la clé,
// connecter Claude, importer un fichier, supprimer les silences, montage en un
// clic, choisir style/format, résultat) : l'audio nomme l'action, la scène la
// JOUE. Presque aucun texte — c'est l'animation qui parle.
//
// Contrat : chaque scène rend dans un panneau du moteur (1080×1920), reçoit
// (id, t0, t1, tone, slide) et retourne { html, js }. Tous les tweens sont
// seek-safe (transforms/autoAlpha/filter uniquement, repeats finis, zéro random).
// Le curseur est le MÊME partout (flèche blanche liseré sombre) : un seul acteur.
// ─────────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round(n * 100) / 100
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ACC = '#FF5A36'
import { claudeBurst } from './anim-pack.mjs'
// géométrie de la barre de commentaire — le zoom du CTA s'y réfère
const BAR_Y = 1150, BAR_H = 132

const CURSOR = (id) => `<svg id="${id}cur" viewBox="0 0 24 24" style="position:absolute;left:0;top:0;width:54px;height:54px;opacity:0"><path d="M5 3l14 8-6 1.5L10.5 19z" fill="#fff" stroke="#0D0D12" stroke-width="1.4"/></svg>`

// curseur : entre, glisse vers (x,y), presse la cible avec compression commune —
// le « contact » physique vient de là (physics-press-reaction)
function cursorClick(id, targetSel, x, y, tMove, tClick) {
  return `
  tl.fromTo('#${id}cur',{x:${x + 330},y:${y + 420},opacity:0},{opacity:1,duration:0.14,ease:'power1.out'},${r2(tMove)});
  tl.to('#${id}cur',{x:${x},y:${y},duration:${r2(Math.max(0.25, tClick - tMove - 0.05))},ease:'power2.inOut'},${r2(tMove + 0.02)});
  tl.to(['${targetSel}','#${id}cur'],{scale:0.93,duration:0.08,ease:'power2.in'},${r2(tClick)});
  tl.to(['${targetSel}','#${id}cur'],{scale:1,duration:0.15,ease:'back.out(2.6)'},${r2(tClick + 0.08)});`
}

// carte standard : surface claire arrondie, ombre portée — la même partout
const card = (id, x, y, w, h, extra = '') =>
  `<div id="${id}" style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:#FFFFFF;border-radius:34px;box-shadow:0 44px 110px rgba(13,13,18,.16);${extra}">`

export const UI_SCENES = {

  // ── « crée ton compte » + « Commencer maintenant » : bouton pressé ─────────
  signup(id, t0, t1, tone, s) {
    const bx = 240, by = 1010, bw = 600, bh = 146
    const tClick = Math.min(t1 - 0.5, (s.clickAt ?? t0 + 1.2))
    const html = `
      ${card(id + 'c', 190, 560, 700, 620)}
        <div style="position:absolute;left:70px;top:78px;width:120px;height:120px;border-radius:30px;background:#0D0D12;display:flex;align-items:center;justify-content:center">
          <svg width="62" height="62" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="9" cy="12" r="3.4"/><circle cx="15" cy="12" r="3.4"/></svg></div>
        <div id="${id}f1" style="position:absolute;left:70px;top:250px;width:560px;height:96px;border-radius:22px;background:#F1F1F4"></div>
        <div id="${id}f2" style="position:absolute;left:70px;top:372px;width:560px;height:96px;border-radius:22px;background:#F1F1F4"></div>
        <div id="${id}dot1" style="position:absolute;left:100px;top:288px;width:200px;height:20px;border-radius:10px;background:#C9C9D2"></div>
        <div id="${id}dot2" style="position:absolute;left:100px;top:410px;width:280px;height:20px;border-radius:10px;background:#C9C9D2"></div>
      </div>
      <div id="${id}btn" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;background:${ACC};border-radius:${bh / 2}px;display:flex;align-items:center;justify-content:center;font-size:44px;font-weight:700;color:#fff;opacity:0;box-shadow:0 26px 70px rgba(255,90,54,.35)">${esc(s.label || 'Commencer maintenant')}</div>
      ${CURSOR(id)}`
    const js = `
  tl.fromTo('#${id}c',{y:220,opacity:0,rotation:2},{y:0,opacity:1,rotation:0,duration:0.5,ease:'power3.out'},${r2(t0)});
  tl.fromTo('#${id}dot1',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.34,ease:'power2.out'},${r2(t0 + 0.4)});
  tl.fromTo('#${id}dot2',{scaleX:0,transformOrigin:'left center'},{scaleX:1,duration:0.34,ease:'power2.out'},${r2(t0 + 0.62)});
  tl.fromTo('#${id}btn',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.44,ease:'back.out(1.7)'},${r2(t0 + 0.55)});
  ${cursorClick(id, '#' + id + 'btn', bx + bw / 2 + 40, by + bh / 2 + 8, tClick - 0.5, tClick)}
  tl.to('#${id}c',{y:-22,duration:${r2(Math.max(0.4, t1 - t0 - 0.5))},ease:'none'},${r2(t0 + 0.5)});`
    return { html, js, sfx: [{ kind: 'mo-tap-1', t: r2(tClick), vol: 0.8 }] }
  },

  // ── « Générer la clé et copie-la » : bouton → clé → toast Copié ────────────
  keycopy(id, t0, t1) {
    const html = `
      ${card(id + 'c', 150, 640, 780, 520)}
        <div style="position:absolute;left:70px;top:70px;width:340px;height:26px;border-radius:13px;background:#E7E7EC"></div>
        <div id="${id}gen" style="position:absolute;left:70px;top:150px;width:380px;height:110px;background:#0D0D12;border-radius:26px;display:flex;align-items:center;justify-content:center;font-size:34px;font-weight:700;color:#fff">Générer la clé</div>
        <div id="${id}key" style="position:absolute;left:70px;top:310px;width:640px;height:110px;border-radius:24px;background:#F1F1F4;display:flex;align-items:center;padding:0 34px;font-family:'JetBrains Mono',monospace;font-size:32px;color:#3A3A44;letter-spacing:.04em;opacity:0">sk-ava-·····-·····-7X4F</div>
      </div>
      <div id="${id}toast" style="position:absolute;left:340px;top:1240px;width:400px;height:104px;background:#0D0D12;border-radius:52px;display:flex;align-items:center;justify-content:center;gap:16px;color:#fff;font-size:36px;font-weight:600;opacity:0">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${ACC}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Copiée</div>
      ${CURSOR(id)}`
    const tClick = t0 + 0.9
    const js = `
  tl.fromTo('#${id}c',{y:200,opacity:0},{y:0,opacity:1,duration:0.46,ease:'power3.out'},${r2(t0)});
  ${cursorClick(id, '#' + id + 'gen', 460, 850, tClick - 0.45, tClick)}
  tl.fromTo('#${id}key',{x:-40,opacity:0},{x:0,opacity:1,duration:0.4,ease:'power3.out'},${r2(tClick + 0.2)});
  tl.fromTo('#${id}toast',{y:60,scale:0.8,opacity:0},{y:0,scale:1,opacity:1,duration:0.4,ease:'back.out(1.8)'},${r2(Math.min(t1 - 0.4, tClick + 0.9))});
  tl.to('#${id}c',{y:-20,duration:${r2(Math.max(0.4, t1 - t0 - 0.4))},ease:'none'},${r2(t0 + 0.4)});`
    return { html, js, sfx: [{ kind: 'mo-tap-1', t: r2(tClick), vol: 0.8 }, { kind: 'mo-impact-1', t: r2(Math.min(t1 - 0.4, tClick + 0.9)), vol: 0.55 }] }
  },

  // ── « importe ton fichier » : le fichier GLISSE dans la dropzone ───────────
  upload(id, t0, t1, tone, s) {
    const isImg = s.file === 'image'
    const fileIcon = isImg
      ? `<svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5-9 9"/></svg>`
      : `<svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7"><path d="M9 18V6l8-2v12"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="14.5" cy="16" r="2.6"/></svg>`
    const html = `
      <div id="${id}dz" style="position:absolute;left:190px;top:660px;width:700px;height:520px;border-radius:40px;border:5px dashed ${tone.mute}55;background:${tone.dark ? '#15151B' : '#FFFFFF'};opacity:0"></div>
      <div id="${id}fl" style="position:absolute;left:452px;top:820px;width:176px;height:176px;border-radius:40px;background:${ACC};display:flex;align-items:center;justify-content:center;opacity:0;box-shadow:0 30px 80px rgba(255,90,54,.4)">${fileIcon}</div>
      <div id="${id}ok" style="position:absolute;left:488px;top:1210px;width:104px;height:104px;border-radius:50%;background:${ACC};display:flex;align-items:center;justify-content:center;opacity:0">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>`
    const tDrop = t0 + 0.85
    const js = `
  tl.fromTo('#${id}dz',{scale:0.86,opacity:0},{scale:1,opacity:1,duration:0.42,ease:'power3.out'},${r2(t0)});
  tl.fromTo('#${id}fl',{x:430,y:-560,rotation:14,opacity:0},{x:0,y:0,rotation:0,opacity:1,duration:${r2(tDrop - t0 - 0.1)},ease:'power2.inOut'},${r2(t0 + 0.1)});
  tl.to('#${id}fl',{scale:0.92,duration:0.09,ease:'power2.in'},${r2(tDrop)});
  tl.to('#${id}fl',{scale:1,duration:0.16,ease:'back.out(2.4)'},${r2(tDrop + 0.09)});
  tl.to('#${id}dz',{scale:1.02,duration:0.12,ease:'power2.out'},${r2(tDrop)});
  tl.to('#${id}dz',{scale:1,duration:0.18,ease:'sine.out'},${r2(tDrop + 0.12)});
  tl.fromTo('#${id}ok',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(2)'},${r2(tDrop + 0.3)});
  tl.to('#${id}dz',{y:-20,duration:${r2(Math.max(0.4, t1 - t0 - 0.4))},ease:'none'},${r2(t0 + 0.4)});`
    return { html, js, sfx: [{ kind: 'pop', t: r2(tDrop), vol: 0.6 }] }
  },

  // ── « Supprimer les silences » : l'ONDE se compresse — le wow du Nettoyage ─
  silencecut(id, t0, t1, tone) {
    // barres déterministes (sinus composé), 3 zones de silence qui se vident puis
    // l'onde se RESSERRE — l'action du produit, jouée, pas racontée
    const N = 46, bw = 12, gap = 8, x0 = (1080 - N * (bw + gap)) / 2
    const sil = new Set([12, 13, 14, 15, 26, 27, 28, 36, 37, 38, 39])
    let bars = ''
    for (let i = 0; i < N; i++) {
      const h = sil.has(i) ? 12 : Math.round(46 + 150 * Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.53) * 0.4))
      bars += `<div id="${id}b${i}" class="${sil.has(i) ? id + 'sil' : id + 'live'}" style="position:absolute;left:${Math.round(x0 + i * (bw + gap))}px;top:${920 - h / 2}px;width:${bw}px;height:${h}px;border-radius:6px;background:${sil.has(i) ? tone.mute + '66' : ACC}"></div>`
    }
    const live = Array.from({ length: N }, (_, i) => i).filter((i) => !sil.has(i))
    // positions finales : les barres vivantes se resserrent au centre
    const x1 = (1080 - live.length * (bw + gap)) / 2
    const moves = live.map((i, k) => `\n  tl.to('#${id}b${i}',{x:${Math.round(x1 + k * (bw + gap) - (x0 + i * (bw + gap)))},duration:0.55,ease:'power3.inOut'},${r2(t0 + 1.5)});`).join('')
    const tCut = t0 + 0.95
    const html = bars + `
      <div id="${id}btn" style="position:absolute;left:290px;top:1120px;width:500px;height:128px;background:#0D0D12;border-radius:64px;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:#fff;opacity:0">Supprimer les silences</div>
      ${CURSOR(id)}`
    const js = `
  tl.fromTo('.${id}live',{scaleY:0.2,opacity:0},{scaleY:1,opacity:1,duration:0.4,stagger:0.012,ease:'power2.out'},${r2(t0)});
  tl.fromTo('.${id}sil',{opacity:0},{opacity:1,duration:0.3},${r2(t0 + 0.2)});
  tl.fromTo('#${id}btn',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(1.7)'},${r2(t0 + 0.3)});
  ${cursorClick(id, '#' + id + 'btn', 570, 1190, tCut - 0.45, tCut)}
  tl.to('.${id}sil',{scaleY:0.05,autoAlpha:0,duration:0.3,ease:'power2.in'},${r2(tCut + 0.15)});${moves}
  tl.to('.${id}live',{scale:1.04,duration:${r2(Math.max(0.3, t1 - t0 - 2.2))},ease:'none'},${r2(t0 + 2.1)});`
    return { html, js, sfx: [{ kind: 'mo-tap-1', t: r2(tCut), vol: 0.8 }, { kind: 'snap', t: r2(tCut + 0.35), vol: 0.6 }] }
  },

  // ── « en un clic » : UN bouton, le clic, la coche — rien d'autre ───────────
  oneclick(id, t0, t1) {
    const tClick = t0 + 0.8
    const html = `
      <div id="${id}btn" style="position:absolute;left:250px;top:880px;width:580px;height:150px;background:${ACC};border-radius:75px;display:flex;align-items:center;justify-content:center;gap:20px;font-size:47px;font-weight:700;color:#fff;opacity:0;box-shadow:0 30px 84px rgba(255,90,54,.4)">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="#fff"><path d="M13 2L4.5 13.5H11L9.8 22l8.7-11.5H12z"/></svg>Lancer le montage</div>
      <div id="${id}rg" style="position:absolute;left:230px;top:860px;width:620px;height:190px;border:4px solid ${ACC};border-radius:95px;opacity:0"></div>
      ${CURSOR(id)}`
    const js = `
  tl.fromTo('#${id}btn',{scale:0,opacity:0},{scale:1,opacity:1,duration:0.46,ease:'back.out(1.7)'},${r2(t0)});
  ${cursorClick(id, '#' + id + 'btn', 590, 962, tClick - 0.42, tClick)}
  tl.fromTo('#${id}rg',{scale:0.75,opacity:0.9},{scale:1.5,opacity:0,duration:0.44,ease:'power2.out'},${r2(tClick + 0.02)});
  tl.to('#${id}btn',{scale:1.035,duration:0.4,ease:'sine.inOut',yoyo:true,repeat:1},${r2(tClick + 0.3)});`
    return { html, js, sfx: [{ kind: 'mo-tap-1', t: r2(tClick), vol: 0.8 }] }
  },

  // ── « choisis un style, des sous-titres, une musique » : pills qui popent ──
  options(id, t0, t1, tone, s) {
    const items = (s.options || ['Style', 'Sous-titres', 'Musique', 'Images']).slice(0, 4)
    const ic = {
      Style: '<path d="M12 3l2.5 6H21l-5 4 2 7-6-4.5L6 20l2-7-5-4h6.5z"/>',
      'Sous-titres': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 14h6M14 14h4" stroke="#fff" stroke-width="1.8" fill="none"/>',
      Musique: '<path d="M9 18V6l8-2v12"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="14.5" cy="16" r="2.6"/>',
      Images: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5-9 9"/>',
    }
    const html = items.map((it, k) => `
      <div id="${id}o${k}" style="position:absolute;left:200px;top:${640 + k * 172}px;width:680px;height:140px;background:${tone.dark ? '#17171E' : '#FFFFFF'};border:3px solid ${k === 0 ? ACC : (tone.dark ? '#26262E' : '#E6E6EB')};border-radius:34px;display:flex;align-items:center;gap:30px;padding:0 44px;box-sizing:border-box;font-size:42px;font-weight:650;color:${tone.ink};opacity:0;${!tone.dark ? 'box-shadow:0 24px 60px rgba(13,13,18,.10)' : ''}">
        <span style="width:76px;height:76px;border-radius:20px;background:${k === 0 ? ACC : tone.mute + '33'};display:flex;align-items:center;justify-content:center"><svg width="40" height="40" viewBox="0 0 24 24" fill="${k === 0 ? '#fff' : tone.mute}" stroke="${k === 0 ? '#fff' : tone.mute}" stroke-width="0.4">${ic[it] || ic.Style}</svg></span>${esc(it)}</div>`).join('')
    const js = items.map((it, k) => {
      const at = s.itemAt && s.itemAt[k] != null ? Math.max(t0, s.itemAt[k]) : t0 + 0.15 + k * 0.3
      const dirs = [{ x: -320 }, { x: 320 }, { x: -320 }, { x: 320 }][k]
      return `
  tl.fromTo('#${id}o${k}',{${Object.entries(dirs).map(([a, b]) => `${a}:${b}`).join(',')},opacity:0},{x:0,opacity:1,duration:0.42,ease:'expo.out'},${r2(at)});
  tl.to('#${id}o${k}',{y:${-12 - k * 4},duration:${r2(Math.max(0.3, t1 - at - 0.45))},ease:'none'},${r2(at + 0.42)});`
    }).join('')
    return { html, js, sfx: [] }
  },

  // ── « Photo réaliste » + « 9:16 » : la carte se choisit sous le curseur ────
  pick(id, t0, t1, tone, s) {
    const items = s.choices || ['Photo réaliste', 'Cartoon 3D']
    const selIdx = s.sel ?? 0
    const cw = items.length > 2 ? 300 : 420, gap = 40
    const x0 = (1080 - items.length * cw - (items.length - 1) * gap) / 2
    const html = items.map((it, k) => `
      <div id="${id}k${k}" style="position:absolute;left:${Math.round(x0 + k * (cw + gap))}px;top:800px;width:${cw}px;height:${Math.round(cw * 0.86)}px;background:${tone.dark ? '#17171E' : '#FFFFFF'};border:4px solid ${tone.dark ? '#26262E' : '#E6E6EB'};border-radius:34px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;font-size:${cw > 350 ? 40 : 33}px;font-weight:650;color:${tone.ink};opacity:0;${!tone.dark ? 'box-shadow:0 24px 60px rgba(13,13,18,.10);' : ''}text-align:center;padding:0 18px;box-sizing:border-box">
        ${s.ratio ? `<span style="width:${cw * 0.3}px;height:${cw * 0.3 * (k === selIdx ? 1.78 : k === 0 ? 1 : 0.56)}px;border-radius:10px;border:4px solid ${tone.mute};display:block"></span>` : ''}${esc(it)}</div>`).join('')
    const sel = `#${id}k${selIdx}`
    const tPick = Math.min(t1 - 0.4, (s.pickAt ?? t0 + 0.9))
    const js = items.map((_, k) => `
  tl.fromTo('#${id}k${k}',{y:140,opacity:0,scale:0.9},{y:0,opacity:1,scale:1,duration:0.4,ease:'power3.out'},${r2(t0 + 0.05 + k * 0.09)});`).join('') + `
  ${cursorClick(id, sel, Math.round(x0 + selIdx * (cw + gap) + cw / 2 + 20), 800 + Math.round(cw * 0.43) + 20, tPick - 0.4, tPick)}
  tl.to('${sel}',{borderColor:'${ACC}',duration:0.18},${r2(tPick)});
  tl.to('${sel}',{scale:1.06,y:-14,duration:0.3,ease:'back.out(1.8)'},${r2(tPick + 0.1)});
  tl.to(${JSON.stringify(items.map((_, k) => '#' + id + 'k' + k).filter((_, k) => k !== selIdx))},{autoAlpha:0.35,scale:0.94,duration:0.3,ease:'power2.inOut'},${r2(tPick + 0.1)});`
    return { html: html + CURSOR(id), js, sfx: [{ kind: 'mo-tap-1', t: r2(tPick), vol: 0.8 }] }
  },

  // ── barre de prompt (référence @saasservices17) : la phrase SE TAPE, caret,
  //    bouton flèche qui se presse à la fin — le prompt est le héros ───────────
  promptbar(id, t0, t1, tone, s) {
    const chars = String(s.text || '')
    // s.sendAt : caler l'ENVOI sur le mot qui le déclenche (« génère l'image ») —
    // sinon l'appui glisse à la fin du panneau, après la phrase
    const sendAt = r2(s.sendAt ? Math.min(t1 - 0.3, Math.max(t0 + 1.6, s.sendAt)) : Math.min(t1 - 0.3, Math.max(t0 + 1.5, t1 - 0.55)))
    const tA = t0 + 0.5, tB = r2(Math.max(tA + 1.0, sendAt - 0.3))
    const step = r2((tB - tA) / Math.max(1, chars.length))
    // le champ porte la marque de l'assistant quand la voix le nomme : « on doit
    // voir quelque chose qui est ÉCRIT DANS CLAUDE » (Axel) — une barre blanche
    // anonyme ne dit pas dans quoi on écrit.
    const mark = s.mark === 'claude'
      ? `<span style="display:inline-flex;width:46px;height:46px;vertical-align:-9px;margin-right:18px">${claudeBurst('100%')}</span>` : ''
    const html = `
      <div id="${id}bar" style="position:absolute;left:110px;top:820px;width:860px;min-height:220px;background:${tone.dark ? '#1A1A21' : '#FFFFFF'};border:2px solid ${tone.dark ? '#2A2A33' : '#E6E6EB'};border-radius:36px;padding:40px 46px 92px;box-sizing:border-box;font-size:40px;font-weight:500;line-height:1.45;color:${tone.ink};opacity:0;box-shadow:0 46px 120px rgba(13,13,18,${tone.dark ? '.5' : '.14'})">
        ${mark}${chars.split('').map((c, ci) => `<span id="${id}ch${ci}" style="display:none">${esc(c)}</span>`).join('')}<span id="${id}cr" style="display:inline-block;width:4px;height:44px;background:${ACC};vertical-align:-7px"></span>
        <div id="${id}snd" style="position:absolute;right:34px;bottom:26px;width:84px;height:84px;border-radius:24px;background:${ACC};display:flex;align-items:center;justify-content:center">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></div>
      </div>`
    let js = `
  tl.fromTo('#${id}bar',{y:180,opacity:0,scale:0.96},{y:0,opacity:1,scale:1,duration:0.5,ease:'power3.out'},${r2(t0)});` +
      // `display` et non `opacity` : un caractère invisible occupait quand même
      // sa place, le curseur attendait donc à la FIN du texte pendant que ça
      // tapait au début. Ici la ligne pousse le curseur, lettre après lettre.
      chars.split('').map((c, ci) => `\n  tl.set('#${id}ch${ci}',{display:'inline'},${r2(tA + step * ci)});`).join('') + `
  tl.to(['#${id}snd'],{scale:0.9,duration:0.08,ease:'power2.in'},${sendAt});
  tl.to(['#${id}snd'],{scale:1,duration:0.16,ease:'back.out(2.6)'},${r2(sendAt + 0.08)});
  tl.to('#${id}bar',{y:-20,duration:${r2(Math.max(0.4, t1 - t0 - 0.5))},ease:'none'},${r2(t0 + 0.5)});`
    // « génère l'image » : après l'appui, la caméra PLONGE sur le bouton d'envoi —
    // le zoom devient la transition vers le panneau suivant (demande d'Axel)
    if (s.zoomEnd) {
      const zs = r2(Math.max(sendAt + 0.12, t1 - 0.6))
      js += `
  tl.to('#${id}bar',{scale:2.2,x:-460,y:-210,duration:${r2(Math.max(0.3, t1 - zs))},ease:'power2.in',transformOrigin:'86% 82%'},${zs});`
    }
    return { html, js, sfx: [{ kind: 'mo-pop-1', t: sendAt, vol: 0.5 }], keyboard: [{ t: r2(tA), dur: r2(tB - tA) }] }
  },

  // ── « rends-toi sur avatarads.fr » : un NAVIGATEUR — l'URL se tape dans la
  //    barre, la page arrive, puis la caméra plonge sur le bouton demandé ───────
  browser(id, t0, t1, tone, s) {
    const url = String(s.url || 'avatarads.fr')
    const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
    const W = 1000, H = 690, X = (1080 - W) / 2, Y = 560
    const tType = t0 + 0.35, tGo = r2(tType + 0.09 * url.length + 0.2)
    // cible du zoom final : le bouton « Commencer » en haut à droite du site
    // cible calée sur la NOUVELLE LP (capture 2880×1800) : « Se connecter » +
    // « Commencer » sont sur la rangée du haut, à y≈0,04. L'ancien 0,146 zoomait
    // sous la barre, dans le vide — Axel : « il aurait dû zoomer sur Commencer ».
    const zx = s.zoomX ?? 0.86, zy = s.zoomY ?? 0.052, zf = s.zoomTo || 2.6
    const tZoom = r2(s.zoomAt ? Math.max(tGo + 0.5, s.zoomAt) : Math.max(tGo + 0.6, t1 - 1.2))
    const html = `
      <div id="${id}win" style="position:absolute;left:${X}px;top:${Y}px;width:${W}px;height:${H}px;background:${tone.dark ? '#17171E' : '#FFFFFF'};border-radius:28px;overflow:hidden;box-shadow:0 60px 150px rgba(13,13,18,.45);opacity:0">
        <div style="position:absolute;left:0;top:0;width:100%;height:96px;background:${tone.dark ? '#1F1F27' : '#F2F2F5'};display:flex;align-items:center;gap:16px;padding:0 28px;box-sizing:border-box">
          ${['#FF5F57', '#FEBC2E', '#28C840'].map((c) => `<span style="width:20px;height:20px;border-radius:50%;background:${c}"></span>`).join('')}
          <span style="flex:1;height:56px;margin-left:18px;border-radius:28px;background:${tone.dark ? '#0E0E13' : '#FFFFFF'};display:flex;align-items:center;padding:0 26px;font-family:'JetBrains Mono',monospace;font-size:28px;color:${tone.ink}">
            ${url.split('').map((c, i) => `<span id="${id}u${i}" style="display:none">${esc(c)}</span>`).join('')}<span id="${id}cr" style="display:inline-block;width:3px;height:32px;background:${ACC};margin-left:2px"></span>
          </span>
        </div>
        <div id="${id}vp" style="position:absolute;left:0;top:96px;width:${W}px;height:${H - 96}px;overflow:hidden;background:${tone.dark ? '#0E0E13' : '#fff'}">
          <img id="${id}pg" src="${file}" style="position:absolute;left:0;top:0;width:${W}px;height:auto;opacity:0" />
        </div>
      </div>`
    let js = `
  tl.fromTo('#${id}win',{y:220,scale:0.94,opacity:0},{y:0,scale:1,opacity:1,duration:0.5,ease:'power3.out'},${r2(t0)});` +
      url.split('').map((c, i) => `\n  tl.set('#${id}u${i}',{display:'inline'},${r2(tType + 0.09 * i)});`).join('') + `
  tl.fromTo('#${id}pg',{opacity:0,y:60},{opacity:1,y:0,duration:0.42,ease:'power3.out'},${tGo});`
    // la page glisse doucement puis la caméra PLONGE sur le bouton — c'est la
    // transition vers la suite (« un zoom sur le bouton plutôt », Axel)
    // ZOOM SUR LE BOUTON, calcul exact. On agrandit l'IMAGE (pas le cadre) depuis
    // son coin haut-gauche, puis on la translate pour amener le point visé au
    // centre du viewport : tx = centre − position_du_point×échelle. Zoomer le
    // cadre lui-même (ancienne version) déplaçait aussi la fenêtre du navigateur,
    // et la cible finissait hors champ.
    const imgH = Math.round(W * (1800 / 2880))     // la capture fait 2880×1800
    const vpH = H - 96
    const tx = r2(W / 2 - zx * W * zf)
    const ty = r2(vpH / 2 - zy * imgH * zf)
    js += `
  tl.to('#${id}win',{y:-16,duration:${r2(Math.max(0.4, tZoom - tGo))},ease:'none'},${r2(tGo + 0.3)});
  tl.fromTo('#${id}pg',{scale:1,x:0,y:0,transformOrigin:'0 0'},{scale:${zf},x:${tx},y:${ty},duration:${r2(Math.max(0.5, t1 - tZoom))},ease:'power2.inOut'},${tZoom});`
    return { html, js, sfx: [{ kind: 'mo-pop-1', t: tGo, vol: 0.45 }], keyboard: [{ t: r2(tType), dur: r2(tGo - tType) }] }
  },

  // ── « des millions de vues » : les compteurs sociaux qui s'emballent ────────
  views(id, t0, t1, tone, s) {
    const rows = [
      { icon: 'M12 21s-7-4.6-9.5-8.2C.6 9.7 2.6 6 6 6c2 0 3.4 1 4 2.2C10.6 7 12 6 14 6c3.4 0 5.4 3.7 3.5 6.8C15 16.4 12 21 12 21z', v: 128400, lab: '' },
      { icon: 'M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-4-.9L3 20l1.1-4.4a8.4 8.4 0 1116.9-4.1z', v: 9260, lab: '' },
      { icon: 'M14 9V5l8 7-8 7v-4C6 15 3 18 2 21c0-6 3-10.5 12-12z', v: 41800, lab: '' },
    ]
    const big = parseInt(String(s.value || '2400000').replace(/\D/g, ''), 10) || 2400000
    const cD = r2(Math.min(1.5, t1 - t0 - 0.4))
    const html = `
      <div class="stack" style="gap:26px">
        <div class="disp" id="${id}big" style="font-size:190px;color:${tone.ink};opacity:0;line-height:1">0</div>
        <div id="${id}lab" style="font-family:'JetBrains Mono',monospace;font-size:40px;letter-spacing:.28em;color:${ACC};opacity:0">VUES</div>
        <div style="display:flex;gap:34px;margin-top:26px">
          ${rows.map((r, k) => `<div id="${id}r${k}" style="display:flex;flex-direction:column;align-items:center;gap:12px;opacity:0">
            <span style="width:104px;height:104px;border-radius:50%;background:${tone.dark ? '#1C1C24' : '#FFFFFF'};display:flex;align-items:center;justify-content:center;box-shadow:0 18px 44px rgba(13,13,18,${tone.dark ? '.5' : '.12'})">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="${ACC}"><path d="${r.icon}"/></svg></span>
            <span id="${id}n${k}" style="font-size:34px;font-weight:700;color:${tone.ink}">0</span></div>`).join('')}
        </div>
      </div>`
    const fmt = (n) => (n >= 1000000 ? (n / 1000000).toFixed(1).replace('.0', '') + 'M' : n >= 1000 ? Math.round(n / 1000) + 'K' : String(n))
    let js = `
  var ${id}v = { b: 0${rows.map((r, k) => `, n${k}: 0`).join('')} };
  tl.fromTo('#${id}big',{scale:0.72,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'back.out(1.5)'},${r2(t0)});
  tl.to(${id}v,{b:${big}${rows.map((r, k) => `, n${k}:${r.v}`).join('')},duration:${cD},ease:'power2.out',onUpdate:function(){
    var f=function(n){return n>=1000000?(n/1000000).toFixed(1).replace('.0','')+'M':n>=1000?Math.round(n/1000)+'K':String(Math.round(n))};
    var e=document.getElementById('${id}big'); if(e) e.textContent=f(${id}v.b);
    ${rows.map((r, k) => `var e${k}=document.getElementById('${id}n${k}'); if(e${k}) e${k}.textContent=f(${id}v.n${k});`).join('\n    ')}
  }},${r2(t0 + 0.1)});
  tl.fromTo('#${id}lab',{y:40,opacity:0},{y:0,opacity:1,duration:0.3,ease:'circ.out'},${r2(t0 + 0.32)});` +
      rows.map((r, k) => `\n  tl.fromTo('#${id}r${k}',{y:70,scale:0.7,opacity:0},{y:0,scale:1,opacity:1,duration:0.4,ease:'back.out(1.7)'},${r2(t0 + 0.4 + k * 0.11)});`).join('') + `
  tl.to('#${id}big',{scale:1.09,duration:${r2(Math.max(0.3, t1 - t0 - cD - 0.2))},ease:'none'},${r2(t0 + 0.1 + cD)});`
    return { html, js, sfx: [{ kind: 'mo-impact-1', t: r2(t0 + 0.1 + cD), vol: 0.5 }] }
  },

  // ── hook « 30 secondes » : un CHRONOMÈTRE animé — anneau qui se trace,
  //    aiguille qui balaie, chiffre qui compte. Du motion design, pas du texte. ──
  timer(id, t0, t1, tone, s) {
    const val = parseInt(String(s.value || '30').replace(/\D/g, ''), 10) || 30
    const cx = 540, cy = 900, R = 300
    const circ = Math.round(2 * Math.PI * R)
    const countDur = r2(Math.min(1.3, t1 - t0 - 0.5))
    const ticks = Array.from({ length: 12 }, (_, k) => {
      const a = (k / 12) * 2 * Math.PI - Math.PI / 2
      const x1 = cx + Math.cos(a) * (R + 34), y1 = cy + Math.sin(a) * (R + 34)
      const x2 = cx + Math.cos(a) * (R + 58), y2 = cy + Math.sin(a) * (R + 58)
      return `<line class="${id}tk" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${tone.mute}" stroke-width="7" stroke-linecap="round" opacity="0"/>`
    }).join('')
    const html = `
      <svg style="position:absolute;left:0;top:0;width:1080px;height:1920px" viewBox="0 0 1080 1920">
        <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${tone.dark ? '#26262E' : '#EDE4DC'}" stroke-width="16"/>
        <circle id="${id}ring" cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ACC}" stroke-width="16"
          stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" transform="rotate(-90 ${cx} ${cy})"/>
        ${ticks}
        <g id="${id}nd"><line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - R + 46}" stroke="${tone.ink}" stroke-width="10" stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="20" fill="${ACC}"/></g>
      </svg>
      <div class="disp" id="${id}n" style="position:absolute;left:0;right:0;top:${cy - 105}px;text-align:center;font-size:170px;color:${tone.ink};opacity:0">0</div>
      <div id="${id}u" style="position:absolute;left:0;right:0;top:${cy + R + 96}px;text-align:center;font-family:'JetBrains Mono',monospace;font-size:42px;letter-spacing:.3em;color:${ACC};opacity:0">${esc(s.unit || 'SECONDES')}</div>`
    const js = `
  var ${id}v = { n: 0, off: ${circ}, a: 0 };
  tl.fromTo('.${id}tk',{opacity:0},{opacity:0.6,duration:0.2,stagger:0.03,ease:'power1.out'},${r2(t0)});
  tl.to(${id}v,{off:0,n:${val},a:360,duration:${countDur},ease:'power2.inOut',onUpdate:function(){
    var rg=document.getElementById('${id}ring'); if(rg) rg.setAttribute('stroke-dashoffset', String(${id}v.off));
    var el=document.getElementById('${id}n'); if(el) el.textContent=String(Math.round(${id}v.n));
    var nd=document.getElementById('${id}nd'); if(nd) nd.setAttribute('transform','rotate('+${id}v.a+' ${cx} ${cy})');
  }},${r2(t0 + 0.15)});
  tl.fromTo('#${id}n',{scale:0.82,opacity:0},{scale:1,opacity:1,duration:0.4,ease:'power2.out'},${r2(t0 + 0.12)});
  tl.fromTo('#${id}u',{y:40,opacity:0},{y:0,opacity:1,duration:0.32,ease:'circ.out'},${r2(t0 + 0.5)});
  tl.to('#${id}n',{scale:1.1,duration:${r2(Math.max(0.3, t1 - t0 - countDur - 0.3))},ease:'none'},${r2(t0 + 0.15 + countDur)});`
    return { html, js, sfx: [{ kind: 'mo-tick-1', t: r2(t0 + 0.1), vol: 0.3 }, { kind: 'mo-pop-1', t: r2(t0 + 0.15 + countDur), vol: 0.5 }] }
  },

  // ── « avec cette qualité-là » : L'IMAGE plein cadre — la preuve, pas du texte ─
  photo(id, t0, t1, tone, s) {
    const file = s.screen ? 'tuto/' + s.screen + '.png' : ''
    const pw = 840, ph = 1180
    const html = `
      <div id="${id}fr" style="position:absolute;left:${(1080 - pw) / 2}px;top:340px;width:${pw}px;height:${ph}px;border-radius:38px;overflow:hidden;box-shadow:0 70px 160px rgba(13,13,18,.5);opacity:0">
        <img id="${id}im" src="${file}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover" />
      </div>
      <div id="${id}tag" style="position:absolute;left:${(1080 - pw) / 2 + 34}px;top:${340 + ph - 118}px;height:76px;padding:0 34px;background:rgba(13,13,18,.55);border-radius:38px;display:flex;align-items:center;gap:14px;font-size:33px;font-weight:650;color:#fff;opacity:0;backdrop-filter:blur(6px)">
        <span style="width:16px;height:16px;border-radius:50%;background:${ACC}"></span>100 % généré par IA</div>`
    const js = `
  tl.fromTo('#${id}fr',{y:340,scale:0.92,opacity:0,rotation:2},{y:0,scale:1,opacity:1,rotation:0,duration:0.55,ease:'power4.out'},${r2(t0)});
  tl.fromTo('#${id}im',{scale:1.18},{scale:1,duration:${r2(Math.max(0.6, t1 - t0 - 0.3))},ease:'none'},${r2(t0 + 0.15)});
  tl.fromTo('#${id}tag',{y:40,opacity:0},{y:0,opacity:1,duration:0.34,ease:'power3.out'},${r2(t0 + 0.5)});
  tl.to('#${id}fr',{y:-24,duration:${r2(Math.max(0.4, t1 - t0 - 0.6))},ease:'none'},${r2(t0 + 0.55)});`
    return { html, js, sfx: [{ kind: 'mo-swipe-1', t: r2(t0 + 0.08), vol: 0.45 }] }
  },

  // ── CTA : la barre de commentaire TikTok — le mot se tape, on l'envoie ─────
  comment(id, t0, t1, tone, s) {
    const word = String(s.word || 'Avatar')
    const tA = t0 + 0.35, step = 0.09
    const tSend = r2(Math.min(t1 - 0.25, tA + step * word.length + 0.45))
    const html = `
      <div id="${id}bar" style="position:absolute;left:110px;top:${BAR_Y}px;width:860px;height:${BAR_H}px;background:${tone.dark ? '#1A1A21' : '#FFFFFF'};border:2px solid ${tone.dark ? '#2A2A33' : '#E6E6EB'};border-radius:66px;display:flex;align-items:center;gap:24px;padding:0 26px;box-sizing:border-box;opacity:0;box-shadow:0 40px 100px rgba(13,13,18,${tone.dark ? '.5' : '.14'})">
        <span style="width:84px;height:84px;border-radius:50%;background:linear-gradient(135deg,${ACC},#FFB03A);flex-shrink:0"></span>
        <span style="font-size:40px;font-weight:500;color:${tone.ink};flex:1;text-align:center">${word.split('').map((c, ci) => `<span id="${id}w${ci}" style="opacity:0">${esc(c)}</span>`).join('')}<span style="display:inline-block;width:4px;height:44px;background:${ACC};vertical-align:-7px"></span></span>
        <span id="${id}snd" style="width:84px;height:84px;border-radius:50%;background:${ACC};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg></span>
      </div>`
    let js = `
  tl.fromTo('#${id}bar',{y:150,opacity:0,scale:0.94},{y:0,opacity:1,scale:1,duration:0.46,ease:'power3.out'},${r2(t0)});` +
      word.split('').map((c, ci) => `\n  tl.set('#${id}w${ci}',{opacity:1},${r2(tA + step * ci)});`).join('') + `
  tl.to('#${id}snd',{scale:0.88,duration:0.08,ease:'power2.in'},${tSend});
  tl.to('#${id}snd',{scale:1,duration:0.18,ease:'back.out(2.8)'},${r2(tSend + 0.08)});`
    // ZOOM SUR LA BARRE après l'envoi : elle monte au centre et grossit, on voit
    // l'avatar à gauche et le bouton envoyer à droite. `soft` pour le premier CTA
    // (respiration), `in` pour le final (on finit dans le geste demandé).
    const zoom = s.zoom || ''
    if (zoom) {
      // 1.7 et pas 2.0 : le mot est centré dans la barre, donc à fort grossissement
      // l'avatar et le bouton envoyer sortaient du cadre — or c'est justement eux
      // qu'on veut voir avec le mot.
      const sc = zoom === 'in' ? 1.22 : 1.15
      const dy = Math.round((960 - (BAR_Y + BAR_H / 2)) * (zoom === 'in' ? 1 : 0.55))
      const zAt = r2(Math.min(t1 - 0.35, tSend + 0.22))
      js += `
  tl.to('#${id}bar',{scale:${sc},y:${dy},duration:${r2(Math.max(0.45, t1 - zAt))},ease:'power2.inOut',transformOrigin:'50% 50%'},${zAt});`
    } else {
      js += `
  tl.to('#${id}bar',{y:-14,duration:${r2(Math.max(0.3, t1 - t0 - 0.5))},ease:'none'},${r2(t0 + 0.5)});`
    }
    // le mot du CTA s'écrit lettre par lettre : on entend la frappe, comme dans
    // les barres de prompt — c'est le même geste, il doit sonner pareil
    return {
      html, js,
      sfx: [{ kind: 'mo-pop-1', t: tSend, vol: 0.5 }],
      keyboard: [{ t: r2(tA), dur: r2(step * word.length + 0.2) }],
    }
  },

  // ── résultat : mockup téléphone, la vidéo joue (l'image fournie) ───────────
  phone(id, t0, t1, tone, s) {
    // l'image de l'utilisateur (son résultat à lui) bat la capture de démo
    const file = s.userFile || (s.screen ? 'tuto/' + s.screen + '.png' : '')
    const pw = 560, ph = 1130
    const html = `
      <div id="${id}ph" style="position:absolute;left:${(1080 - pw) / 2}px;top:420px;width:${pw}px;height:${ph}px;background:#0D0D12;border-radius:64px;padding:16px;box-sizing:border-box;box-shadow:0 60px 150px rgba(13,13,18,.45);opacity:0">
        <div style="position:absolute;inset:16px;border-radius:50px;overflow:hidden">
          <img id="${id}im" src="${file}" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover" />
          <div style="position:absolute;left:24px;bottom:26px;display:flex;flex-direction:column;gap:10px">
            <span style="width:210px;height:16px;border-radius:8px;background:rgba(255,255,255,.85)"></span>
            <span style="width:150px;height:16px;border-radius:8px;background:rgba(255,255,255,.5)"></span></div>
          <div style="position:absolute;right:20px;bottom:120px;display:flex;flex-direction:column;gap:26px">
            ${['M12 21s-7-4.6-9.5-8.2C.6 9.7 2.6 6 6 6c2 0 3.4 1 4 2.2C10.6 7 12 6 14 6c3.4 0 5.4 3.7 3.5 6.8C15 16.4 12 21 12 21z', 'M21 11.5a8.4 8.4 0 01-9 8.4 8.6 8.6 0 01-4-.9L3 20l1.1-4.4a8.4 8.4 0 1116.9-4.1z', 'M14 9V5l8 7-8 7v-4C6 15 3 18 2 21c0-6 3-10.5 12-12z'].map((d) => `<span style="width:64px;height:64px;border-radius:50%;background:rgba(13,13,18,.45);display:flex;align-items:center;justify-content:center"><svg width="34" height="34" viewBox="0 0 24 24" fill="#fff"><path d="${d}"/></svg></span>`).join('')}
          </div>
        </div>
      </div>`
    const js = `
  tl.fromTo('#${id}ph',{y:520,rotation:5,opacity:0},{y:0,rotation:0,opacity:1,duration:0.6,ease:'power4.out'},${r2(t0)});
  tl.fromTo('#${id}im',{scale:1.15},{scale:1,duration:${r2(Math.max(0.5, t1 - t0 - 0.4))},ease:'none'},${r2(t0 + 0.2)});
  tl.to('#${id}ph',{y:-26,duration:${r2(Math.max(0.4, t1 - t0 - 0.7))},ease:'none'},${r2(t0 + 0.6)});`
    return { html, js, sfx: [] }
  },
}

export function uiScene(name, id, t0, t1, tone, slide) {
  const fn = UI_SCENES[name]
  if (!fn) return null
  return fn(id, t0, t1, tone, slide || {})
}
