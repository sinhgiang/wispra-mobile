import SwiftUI
import WidgetKit

/// The extension has one thing to show: the Live Activity of a recording.
@main
struct WispraRecordingBundle: WidgetBundle {
  var body: some Widget {
    RecordingLiveActivity()
  }
}
