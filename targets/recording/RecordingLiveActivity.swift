import ActivityKit
import SwiftUI
import WidgetKit

/// The recording indicator (T-1073), as in the owner's brief: a small sign at the top of the screen (the
/// Dynamic Island) and on the lock screen. Tapping it opens Wispra where it was, on the recording (no URL is
/// set on purpose: a link would send the app to its first screen and end the recording).
/// Brand colours of the app: purple while recording, amber when it is waiting. As small and faint as the
/// system allows (the owner asked for a faint sign, not a banner): iOS draws the island black and fixes where
/// it is, so what can be faint is the wave and the timer in it, and the card on the lock screen.
private let purple = Color(red: 0.388, green: 0.400, blue: 0.945)
private let amber = Color(red: 0.961, green: 0.620, blue: 0.043)
private let ink = Color(red: 0.059, green: 0.067, blue: 0.090)
private let faint = 0.6

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
      .opacity(faint)
  }
}

private struct RecordingLockScreen: View {
  let attributes: RecordingActivityAttributes
  let state: RecordingActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 10) {
      ZStack {
        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(state.tint.opacity(0.18))
        WaveGlyph(state: state).font(.system(size: 14, weight: .semibold))
      }
      .frame(width: 30, height: 30)
      VStack(alignment: .leading, spacing: 1) {
        Text("Wispra · \(attributes.kind)").font(.subheadline.weight(.semibold)).foregroundStyle(.white.opacity(0.85))
        Text(state.label).font(.footnote).foregroundStyle(.white.opacity(0.5))
      }
      Spacer(minLength: 8)
      RecordingTimer(state: state)
        .font(.callout.weight(.semibold))
        .foregroundStyle(.white.opacity(0.7))
        .frame(width: 64, alignment: .trailing)
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .activityBackgroundTint(ink.opacity(0.7))
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
          .font(.caption2.weight(.medium))
          .foregroundStyle(.white.opacity(0.55))
          .frame(width: 40, alignment: .trailing)
      } minimal: {
        WaveGlyph(state: context.state)
      }
      .keylineTint(context.state.tint.opacity(faint))
    }
  }
}
