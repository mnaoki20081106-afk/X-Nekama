import Foundation

// Compile together with NativeGrok.swift using -module-name Grok on Linux or macOS.
// This exercises waiting/streaming/complete states and wrong-prompt isolation.
struct PublishedValue<T> { var storage: T }
enum GrokChatItemStatus { case complete, generating, errorLoading }
struct GrokChatItem {
    var status: GrokChatItemStatus
    var text: String
    var isPartial: Bool
    var errorMessage: String
}
struct GrokComposeStyle { var prompt = "natural" }
final class GrokComposeRevisionViewModel {
    var originalText: String
    var style = GrokComposeStyle()
    var _revisionChatItem: PublishedValue<GrokChatItem?>
    init(_ prompt: String, status: GrokChatItemStatus = .generating, text: String = "", partial: Bool = false) {
        originalText = prompt
        _revisionChatItem = PublishedValue(storage: GrokChatItem(status: status, text: text, isPartial: partial, errorMessage: ""))
    }
}
final class FakeModel { var _revisions = PublishedValue(storage: [GrokComposeRevisionViewModel]()) }
final class FakeController { var nativeStyle = GrokComposeStyle() }

@main struct NativeGrokTests {
    static func snapshot(_ model: FakeModel, _ prompt: String) -> [String: Any] {
        let ns = prompt as NSString
        return withExtendedLifetime(ns) {
            let result = nativeGrokSnapshot(Unmanaged.passUnretained(model).toOpaque(), Unmanaged.passUnretained(ns).toOpaque())!
            defer { free(result) }
            return try! JSONSerialization.jsonObject(with: Data(String(cString: result).utf8)) as! [String: Any]
        }
    }
    static func main() {
        let model = FakeModel()
        precondition(snapshot(model, "prompt")["state"] as? String == "waiting")
        model._revisions.storage = [GrokComposeRevisionViewModel("other", status: .complete, text: "別の結果")]
        precondition(snapshot(model, "prompt")["text"] == nil)
        model._revisions.storage = [GrokComposeRevisionViewModel("prompt", text: "途中")]
        precondition(snapshot(model, "prompt")["text"] == nil)
        model._revisions.storage = [GrokComposeRevisionViewModel("prompt", status: .complete, text: "未確定", partial: true)]
        precondition(snapshot(model, "prompt")["text"] == nil)
        model._revisions.storage = [GrokComposeRevisionViewModel("prompt", status: .complete, text: "自然な投稿")]
        precondition(snapshot(model, "prompt")["text"] as? String == "自然な投稿")
        let controller = FakeController(), ns = "prompt" as NSString
        let duplicate = nativeGrokStart(Unmanaged.passUnretained(model).toOpaque(), Unmanaged.passUnretained(controller).toOpaque(), Unmanaged.passUnretained(ns).toOpaque(), { _, _, _ in fatalError("duplicate generation") })
        precondition(duplicate == 2)
        let fresh = "new prompt" as NSString
        let started = nativeGrokStart(Unmanaged.passUnretained(model).toOpaque(), Unmanaged.passUnretained(controller).toOpaque(), Unmanaged.passUnretained(fresh).toOpaque(), { string, style, object in
            precondition(String(reflecting: string.load(as: String.self)).contains("new prompt"))
        })
        precondition(started == 1)
        print("NativeGrok: 7 state, isolation, and duplicate-generation checks passed")
    }
}
