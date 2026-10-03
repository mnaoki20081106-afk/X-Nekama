import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Inspect actual, live Swift values. No fixed offsets or fabricated private selectors.
// Field names were checked against X 12.29 (20)'s __swift5_fieldmd.
private func field(_ value: Any, _ name: String) -> Any? {
    var mirror: Mirror? = Mirror(reflecting: value)
    while let current = mirror {
        if let child = current.children.first(where: { $0.label == name }) { return child.value }
        mirror = current.superclassMirror
    }
    return nil
}

private func search(_ root: Any, depth: Int = 0, budget: inout Int,
                    seen: inout Set<ObjectIdentifier>, predicate: (Any) -> Bool) -> Any? {
    guard depth < 28, budget > 0 else { return nil }
    budget -= 1
    if predicate(root) { return root }
    var mirror: Mirror? = Mirror(reflecting: root)
    if mirror?.displayStyle == .class {
        let identity = ObjectIdentifier(root as AnyObject)
        guard seen.insert(identity).inserted else { return nil }
    }
    while let current = mirror {
        for child in current.children {
            if let result = search(child.value, depth: depth + 1, budget: &budget,
                                   seen: &seen, predicate: predicate) { return result }
        }
        mirror = current.superclassMirror
    }
    return nil
}

private func find(_ root: Any, predicate: (Any) -> Bool) -> Any? {
    var budget = 2000
    var seen = Set<ObjectIdentifier>()
    return search(root, budget: &budget, seen: &seen, predicate: predicate)
}

private func revisions(_ model: Any) -> [Any] {
    guard let published = field(model, "_revisions"),
          let array = find(published, predicate: {
              Mirror(reflecting: $0).displayStyle == .collection &&
                  String(reflecting: type(of: $0)) == "Swift.Array<Grok.GrokComposeRevisionViewModel>"
          }) else { return [] }
    return Mirror(reflecting: array).children.map(\.value)
}

public typealias NativeComposeCall = @convention(c) (UnsafeRawPointer, UnsafeRawPointer, UnsafeRawPointer) -> Void

@_cdecl("NXNativeGrokStart")
public func nativeGrokStart(_ modelRaw: UnsafeRawPointer, _ controllerRaw: UnsafeRawPointer,
                            _ textRaw: UnsafeRawPointer, _ call: NativeComposeCall) -> Int32 {
    let model = Unmanaged<AnyObject>.fromOpaque(modelRaw).takeUnretainedValue()
    let controller = Unmanaged<AnyObject>.fromOpaque(controllerRaw).takeUnretainedValue()
    let text = Unmanaged<NSString>.fromOpaque(textRaw).takeUnretainedValue() as String
    if revisions(model).contains(where: { (field($0, "originalText") as? String) == text }) { return 2 }
    let style = revisions(model).compactMap { field($0, "style") }.first ?? find(controller, predicate: {
        String(reflecting: type(of: $0)) == "Grok.GrokComposeStyle"
    })
    guard let style else { return 0 } // Native style picker may need its first selection.
    func invoke<T>(_ style: T) {
        withUnsafePointer(to: style) { stylePointer in
            withUnsafePointer(to: text) { stringPointer in
                call(UnsafeRawPointer(stringPointer), UnsafeRawPointer(stylePointer), modelRaw)
            }
        }
    }
    _openExistential(style, do: invoke)
    return 1
}

@_cdecl("NXNativeGrokSnapshot")
public func nativeGrokSnapshot(_ modelRaw: UnsafeRawPointer, _ expectedRaw: UnsafeRawPointer) -> UnsafeMutablePointer<CChar>? {
    let model = Unmanaged<AnyObject>.fromOpaque(modelRaw).takeUnretainedValue()
    let expected = Unmanaged<NSString>.fromOpaque(expectedRaw).takeUnretainedValue() as String
    var snapshot: [String: Any] = ["state": "waiting"]
    if let revision = revisions(model).first(where: { (field($0, "originalText") as? String) == expected }),
       let published = field(revision, "_revisionChatItem"),
       let item = find(published, predicate: { field($0, "status") != nil && field($0, "text") is String }) {
        let status = field(item, "status").map { String(describing: $0) } ?? "unknown"
        snapshot["state"] = status
        if status == "complete", (field(item, "isPartial") as? Bool) != true {
            snapshot["text"] = field(item, "text") as? String ?? ""
        }
        if let error = field(item, "errorMessage") as? String, !error.isEmpty { snapshot["error"] = error }
    }
    guard let data = try? JSONSerialization.data(withJSONObject: snapshot),
          let string = String(data: data, encoding: .utf8) else { return nil }
    return strdup(string)
}
