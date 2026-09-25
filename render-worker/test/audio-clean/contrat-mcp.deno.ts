// contrat-mcp.deno.ts — lancé par serveur.test.mjs (si Deno est installé) : le VRAI module
// du MCP (supabase/functions/mcp/nettoyage-voix.ts) appelle le VRAI serveur audio du worker.
// Aucun secours ElevenLabs configuré : si le contrat entre les deux casse, ce script échoue.
import { nettoyerVoix } from '../../../supabase/functions/mcp/nettoyage-voix.ts'

const [url, cle, fichier, contentType] = Deno.args
const journal: string[] = []
const r = await nettoyerVoix(await Deno.readFile(fichier), contentType, {
  workerUrl: url, workerKey: cle, elevenKey: '', journal: (m) => journal.push(m),
})
console.log(JSON.stringify({ ok: r instanceof Uint8Array, octets: r instanceof Uint8Array ? r.length : 0, erreur: typeof r === 'string' ? r : null, entete: r instanceof Uint8Array ? String.fromCharCode(...r.slice(0, 3)) : '', journal }))
