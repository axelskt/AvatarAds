// Tracker de clics Auto-DM + attribution des inscriptions — AvatarAds. Toute la logique est dans handler.ts
// (importable par les tests sans démarrer de serveur). verify_jwt=false (config.toml).
import { handler } from './handler.ts'

Deno.serve(handler)
