// Creative Factory — rend UN emoji Apple (police Apple Color Emoji du Mac) en PNG transparent haute définition, recadré.
// Axel 12/10 : « les émojis sont flous » → l'image officielle ne fait que 64 px ; ici on dessine en 256 px.
// Usage : emoji-render <emoji> <taille px> <sortie.png>
import AppKit

let args = CommandLine.arguments
guard args.count >= 4, let size = Double(args[2]) else { fputs("usage: emoji-render <emoji> <px> <out.png>\n", stderr); exit(2) }
let font = NSFont(name: "Apple Color Emoji", size: CGFloat(size)) ?? NSFont.systemFont(ofSize: CGFloat(size))
let str = NSAttributedString(string: args[1], attributes: [.font: font])
let b = str.boundingRect(with: NSSize(width: 10000, height: 10000), options: [.usesLineFragmentOrigin, .usesFontLeading])
let w = Int(ceil(b.width)), h = Int(ceil(b.height))
guard w > 0, h > 0, let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
  hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
str.draw(at: NSPoint(x: -b.origin.x, y: -b.origin.y))
NSGraphicsContext.restoreGraphicsState()
// recadrage sur les pixels non transparents
var x0 = w, y0 = h, x1 = -1, y1 = -1
for y in 0..<h { for x in 0..<w { if let c = rep.colorAt(x: x, y: y), c.alphaComponent > 0.02 { x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y) } } }
guard x1 >= x0, y1 >= y0, let cg = rep.cgImage, let crop = cg.cropping(to: CGRect(x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1)) else { exit(1) }
let out = NSBitmapImageRep(cgImage: crop)
guard let png = out.representation(using: .png, properties: [:]) else { exit(1) }
do { try png.write(to: URL(fileURLWithPath: args[3])) } catch { exit(1) }
