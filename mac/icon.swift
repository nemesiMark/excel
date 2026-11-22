// Disegna l'icona di Excel (1024×1024) e la salva come PNG nel percorso indicato.
import Cocoa

let size: CGFloat = 1024
let out = CommandLine.arguments[1]
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size),
                           bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                           colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// Riquadro arrotondato con lieve sfumatura (misure della griglia icone macOS: 824px con margine 100)
let rect = NSRect(x: 100, y: 100, width: 824, height: 824)
let shape = NSBezierPath(roundedRect: rect, xRadius: 185, yRadius: 185)
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
shadow.shadowOffset = NSSize(width: 0, height: -10)
shadow.shadowBlurRadius = 24
NSGraphicsContext.saveGraphicsState()
shadow.set()
NSColor(srgbRed: 0.07, green: 0.42, blue: 0.24, alpha: 1).setFill()
shape.fill()
NSGraphicsContext.restoreGraphicsState()
// Sfumatura diagonale come il logo della pagina web (#21a366 → #085c36)
let grad = NSGradient(starting: NSColor(srgbRed: 0x21/255, green: 0xa3/255, blue: 0x66/255, alpha: 1),
                      ending: NSColor(srgbRed: 0x08/255, green: 0x5c/255, blue: 0x36/255, alpha: 1))!
grad.draw(in: shape, angle: -45)
let edge = NSBezierPath(roundedRect: rect.insetBy(dx: 8, dy: 8), xRadius: 177, yRadius: 177)
edge.lineWidth = 16
NSColor.white.withAlphaComponent(0.14).setStroke()
edge.stroke()

// «E» fatta di celle staccate, con le stesse misure del logo web (griglia di 32 punti)
let k = rect.width / 32
func cell(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSBezierPath {
  let r = NSRect(x: rect.minX + (x - 0.25) * k, y: rect.minY + (32 - y - h) * k, width: w * k, height: h * k)
  return NSBezierPath(roundedRect: r, xRadius: 1.4 * k, yRadius: 1.4 * k)
}
let markShadow = NSShadow()
markShadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
markShadow.shadowOffset = NSSize(width: 0, height: -8)
markShadow.shadowBlurRadius = 18
NSGraphicsContext.saveGraphicsState()
markShadow.set()
NSColor.white.setFill()
cell(9, 8, 4, 16).fill()
cell(14.5, 8, 9, 4).fill()
cell(14.5, 20, 9, 4).fill()
cell(14.5, 14, 7, 4).fill()
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
