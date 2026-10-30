# Banc faille 2 (Décupleur, 30/10) : ce que ferait le VRAI yt-dlp avec les options données — sans réseau.
# Lit la bibliothèque yt_dlp installée (Homebrew), choisit l'extracteur comme YoutubeDL.extract_info (premier extracteur
# chargé dont _VALID_URL accepte le lien, dans l'ordre de --use-extractors / « default ») et applique le --match-filter réel.
# Entrée : argv[1] = options yt-dlp (JSON, sans le lien), argv[2] = lien, argv[3] = infos de la vidéo (JSON).
# Sortie : {"ie": <clé de l'extracteur ou null>, "filtre": <null = passe, sinon le message de refus>}
import json
import sys

from yt_dlp import YoutubeDL, parse_options

opts = parse_options(json.loads(sys.argv[1])).ydl_opts
url = sys.argv[2]
info = json.loads(sys.argv[3])
with YoutubeDL({'allowed_extractors': opts.get('allowed_extractors') or ['default'], 'quiet': True}) as y:
    ie = next((k for k, e in y._ies.items() if e.suitable(url)), None)
mf = opts.get('match_filter')
filtre = mf(info, incomplete=False) if mf else None
print(json.dumps({'ie': ie, 'filtre': filtre}))
