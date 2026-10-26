# Début de la voix d'un clip (Axel 27/10 : « dès le premier centième de seconde la voix parle ») — les prises Omni ont jusqu'à
# 0,7 s de blanc avant le 1er mot (H81 × A3-2, H24 × A1-13) : le hook habillé est coupé là, image ET son.
import subprocess, numpy as np

def debut_voix(f):
    """1er instant (s) où la voix part : tranches de 10 ms ; attaque franche (bruit de fond + 15 dB, tenue 30 ms) puis on
    remonte la montée tant qu'on reste au-dessus du bruit de fond + 6 dB (sinon la 1re consonne était coupée)"""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    n = len(x) // 160; e = 20 * np.log10(np.sqrt((x[:n * 160].reshape(n, 160) ** 2).mean(1)) + 1e-9)
    fond = np.percentile(e, 10); seuil = max(fond + 15, np.percentile(e, 99) - 30)
    for i in range(n - 3):
        if (e[i:i + 4] > seuil).sum() >= 3:
            while i > 0 and e[i - 1] > fond + 6: i -= 1
            return i * 0.01
    return 0.0

def images_a_couper(f, fps, marge=0.02):
    """nombre d'images à retirer en tête pour que la voix parte dès la 1re (on garde `marge` s de souffle avant)"""
    return int(max(0.0, debut_voix(f) - marge) * fps)
