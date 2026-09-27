-- Suite audit 28/09 : certains serveurs annoncent « image/jpg » (non standard) ; le MCP reprend le type annoncé par
-- l'hébergeur de la photo → l'envoi vers mcp-media était refusé depuis la liste de types. Type inoffensif (jamais
-- interprété comme HTML), ajouté à la liste.
update storage.buckets
   set allowed_mime_types = array['video/mp4','image/png','image/jpeg','image/jpg','image/webp','audio/wav','audio/wave','audio/x-wav','audio/mpeg']
 where id = 'mcp-media';
