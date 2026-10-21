// Creative Factory — DÉTOURAGE de l'avatar (Vision, macOS) pour l'essai « fond vert » (Axel 21/10) : pour chaque image, un
// masque en niveaux de gris (blanc = la personne) à la taille de l'image, écrit à côté avec le suffixe -m.png.
// usage : swiftc -O person-mask.swift -o person-mask && ./person-mask img1.png img2.png …
import Foundation
import Vision
import AppKit
import CoreImage

let ctx = CIContext()
for path in CommandLine.arguments.dropFirst() {
  guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("illisible \(path)"); continue }
  let req = VNGeneratePersonSegmentationRequest()
  req.qualityLevel = .accurate
  req.outputPixelFormat = kCVPixelFormatType_OneComponent8
  do { try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req]) } catch { print("vision \(path)"); continue }
  guard let buf = req.results?.first?.pixelBuffer else { print("vide \(path)"); continue }
  var m = CIImage(cvPixelBuffer: buf)
  m = m.transformed(by: CGAffineTransform(scaleX: CGFloat(cg.width) / m.extent.width, y: CGFloat(cg.height) / m.extent.height))
  let out = URL(fileURLWithPath: path.replacingOccurrences(of: ".png", with: "-m.png"))
  try? ctx.writePNGRepresentation(of: m, to: out, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
}
