// Creative Factory — détection de visages (Vision, macOS) pour placer le texte choc JAMAIS sur un visage (usine/face-zones.mjs).
// usage : face-zones <img>... → une ligne JSON par image :
//   {"file":…, "w":…, "h":…, "faces":[[x, y, w, h, confiance], …]}  (boîtes normalisées 0-1, origine HAUT-gauche)
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("{\"file\":\"\(path)\",\"error\":\"illisible\"}"); continue
  }
  let req = VNDetectFaceRectanglesRequest()
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  do { try handler.perform([req]) } catch { print("{\"file\":\"\(path)\",\"error\":\"vision\"}"); continue }
  let faces = (req.results ?? []).map { r -> String in
    let b = r.boundingBox   // Vision : origine bas-gauche → on retourne l'axe vertical
    return String(format: "[%.4f,%.4f,%.4f,%.4f,%.2f]", b.origin.x, 1 - b.origin.y - b.size.height, b.size.width, b.size.height, r.confidence)
  }
  print("{\"file\":\"\(path)\",\"w\":\(cg.width),\"h\":\(cg.height),\"faces\":[\(faces.joined(separator: ","))]}")
}
