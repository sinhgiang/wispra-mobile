import ActivityKit
import SwiftUI
import WidgetKit

/// The recording indicator (T-1073), as in the owner's brief: a small wave at the top of the screen
/// (the Dynamic Island) and on the lock screen. Tapping it opens Wispra where it was, on the recording
/// (no URL is set on purpose: a link would send the app to its first screen and end the recording).
/// Brand colours of the app: purple while recording, amber when it is waiting.
private let purple = Color(red: 0.388, green: 0.400, blue: 0.945)
private let amber = Color(red: 0.961, green: 0.620, blue: 0.043)
private let ink = Color(red: 0.059, green: 0.067, blue: 0.090)

private extension RecordingActivityAttributes.ContentState {
  var recording: Bool { status == "recording" }
  var tint: Color { recording ? purple : amber }
  var label: String {
    switch status {
    case "paused": return "Paused"
    case "interrupted": return "Waiting for the microphone"
    default: return "Recording"
    }
  }
}

/// How long it has recorded; stops where it was while paused or waiting
private struct RecordingTimer: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    Text(timerInterval: state.startedAt...Date.distantFuture, pauseTime: state.pausedAt, countsDown: false, showsHours: false)
      .monospacedDigit()
      .multilineTextAlignment(.trailing)
  }
}

private struct WaveGlyph: View {
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    Image(systemName: state.recording ? "waveform" : "pause.fill")
      .foregroundStyle(state.tint)
  }
}

private struct RecordingLockScreen: View {
  let attributes: RecordingActivityAttributes
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 12) {
      ZStack {
        RoundedRectangle(cornerRadius: 10, style: .continuous).fill(state.tint.opacity(0.22))
        WaveGlyph(state: state).font(.system(size: 18, weight: .semibold))
      }
      .frame(width: 40, height: 40)
      VStack(alignment: .leading, spacing: 2) {
        Text("Wispra · \(attributes.kind)").font(.headline).foregroundStyle(.white)
        Text(state.label).font(.subheadline).foregroundStyle(.white.opacity(0.65))
      }
      Spacer(minLength: 8)
      RecordingTimer(state: state)
        .font(.title3.weight(.semibold))
        .foregroundStyle(.white)
        .frame(width: 76, alignment: .trailing)
    }
    .padding(16)
    .activityBackgroundTint(ink)
    .activitySystemActionForegroundColor(.white)
  }
}

struct RecordingLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
      RecordingLockScreen(attributes: context.attributes, state: context.state)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          WaveGlyph(state: context.state).font(.title3)
        }
        DynamicIslandExpandedRegion(.trailing) {
          RecordingTimer(state: context.state)
            .font(.title3.weight(.semibold))
            .frame(width: 70, alignment: .trailing)
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(context.attributes.kind) · \(context.state.label)").font(.subheadline)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text("Tap to open Wispra").font(.footnote).foregroundStyle(.secondary)
        }
      } compactLeading: {
        WaveGlyph(state: context.state)
      } compactTrailing: {
        RecordingTimer(state: context.state)
          .font(.caption.weight(.semibold))
          .frame(width: 46, alignment: .trailing)
      } minimal: {
        WaveGlyph(state: context.state)
      }
      .keylineTint(context.state.tint)
    }
  }
}
