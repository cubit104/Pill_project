
// MARK: - PillSeek: on-device label OCR (Apple Vision) exposed to the web layer as "VisionOCR".
// Lives in the app target so no Xcode project changes are needed; registered from PillSeekViewController below.

import Vision

@objc(VisionOCRPlugin)
public class VisionOCRPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VisionOCRPlugin"
    public let jsName = "VisionOCR"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise)
    ]

    @objc func recognize(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            call.reject("Could not decode the image")
            return
        }
        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            var lines: [[String: Any]] = []
            for obs in (request.results as? [VNRecognizedTextObservation]) ?? [] {
                guard let best = obs.topCandidates(1).first else { continue }
                let box = obs.boundingBox // normalised, origin bottom-left
                lines.append([
                    "text": best.string,
                    "confidence": Double(best.confidence),
                    "x": Double(box.origin.x),
                    "y": Double(1 - box.origin.y - box.height),
                    "w": Double(box.width),
                    "h": Double(box.height),
                ])
            }
            call.resolve(["lines": lines])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        let orientation = VisionOCRPlugin.cgOrientation(image.imageOrientation)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:]).perform([request])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

/// The storyboard's root view controller; registers app-local plugins with the Capacitor bridge.
class PillSeekViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(VisionOCRPlugin())
    }
}
