#!/usr/bin/env node
// Creative Factory — applique le MASTERING VOIX « Podcast » (réplique de _acMasterVoice, preset podcast)
// à une brique .wav autonome (ex. un CTA réenregistré par Axel), en place. Trim des blancs de bord + fondus.
// Usage : node usine/master-brick.mjs <brique.wav> [autre.wav ...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MASTER = 'highpass=f=78:width_type=q:width=0.7'
  + ',equalizer=f=400:width_type=q:width=0.95:g=-4.2'
  + ',equalizer=f=175:width_type=q:width=0.8:g=1.4'
  + ',highshelf=f=3400:g=6.8'
  + ',acompressor=threshold=-25dB:ratio=4.8:attack=3:release=110'
  + ',loudnorm=I=-14.8:TP=-1.5:LRA=11';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: master-brick.mjs <wav> [wav...]'); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), 'master-'));
for (const f of files) {
  const tmp = join(work, 'm.wav');
  // trim blancs de bord (leading + trailing via areverse) → master → fondus courts
  execFileSync('ffmpeg', ['-v','error','-y','-i', f,
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.10:detection=peak,areverse,'
      + MASTER + ',afade=t=in:st=0:d=0.02',
    '-ac','1','-ar','48000', tmp]);
  const d0 = parseFloat(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0', tmp]).toString().trim());
  execFileSync('ffmpeg', ['-v','error','-y','-i', tmp, '-af',`afade=t=out:st=${Math.max(0,d0-0.05).toFixed(3)}:d=0.05`, '-ac','1','-ar','48000', f]);  // réécrit en place
  const dur = execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0', f]).toString().trim();
  console.log(`✓ masterisé (podcast) : ${f.split('/').pop()}  [${(+dur).toFixed(1)}s]`);
}
