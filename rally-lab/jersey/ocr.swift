// Read digits in images with Apple's on-device text recognition (Vision). Prints one JSON line per image:
// {"img": path, "hits": [{"text", "conf", "x", "y", "w", "h"}]} (box in 0-1 image coordinates, origin top-left).
import Foundation
import Vision
import CoreImage

let paths = CommandLine.arguments.dropFirst()
for path in paths {
  guard let img = CIImage(contentsOf: URL(fileURLWithPath: path)) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  req.minimumTextHeight = 0.01
  let handler = VNImageRequestHandler(ciImage: img, options: [:])
  try? handler.perform([req])
  var hits: [[String: Any]] = []
  for obs in req.results ?? [] {
    for cand in obs.topCandidates(3) {
      let t = cand.string.trimmingCharacters(in: .whitespaces)
      let digits = t.filter { $0.isNumber }
      if t.isEmpty || t.count > 12 { continue }; _ = digits
      let b = obs.boundingBox
      hits.append(["text": digits, "conf": cand.confidence, "x": b.minX, "y": 1 - b.maxY, "w": b.width, "h": b.height])
    }
  }
  let line: [String: Any] = ["img": path, "hits": hits]
  if let d = try? JSONSerialization.data(withJSONObject: line), let s = String(data: d, encoding: .utf8) { print(s) }
}
