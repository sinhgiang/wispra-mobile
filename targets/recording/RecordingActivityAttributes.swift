import ActivityKit
import Foundation

/// What the Live Activity of a recording is made of (T-1073). The app starts and updates the activity
/// (modules/wispra-keyboard-bridge/ios/RecordingActivityController.swift) and the widget extension
/// draws it (RecordingLiveActivity.swift). iOS matches the two by this type's name and its encoded
/// fields, so the app and the extension each hold an identical copy of this file, kept equal by a `diff`
/// in .github/workflows/ios.yml, as with SharedChannel.swift.
struct RecordingActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    /// "recording", "paused" or "interrupted" (the microphone was taken by a call)
    var status: String
    /// When the recording started, moved forward by the time it was paused, so that a timer counting from
    /// here shows how long it has recorded
    var startedAt: Date
    /// While not recording, where the timer stops (nil while recording)
    var pausedAt: Date?
  }

  /// "Dictation", "Note" or "Meeting"
  var kind: String
}
