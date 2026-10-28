import ActivityKit
import Foundation

/// Starts, updates and ends the Live Activity of a recording (T-1073). It never fails the recording: with
/// Live Activities turned off in Settings, or when iOS refuses, there is simply no indicator.
final class RecordingActivityController {
  static let shared = RecordingActivityController()

  private var activity: Activity<RecordingActivityAttributes>?

  /// Shows the indicator, or changes it when it is already there. `startedAtMs` and `pausedAtMs` are
  /// milliseconds since 1970; a pausedAtMs of 0 means it is recording.
  @discardableResult
  func show(kind: String, status: String, startedAtMs: Double, pausedAtMs: Double) -> Bool {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
    let state = RecordingActivityAttributes.ContentState(
      status: status,
      startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
      pausedAt: pausedAtMs > 0 ? Date(timeIntervalSince1970: pausedAtMs / 1000) : nil
    )
    let content = ActivityContent(state: state, staleDate: nil)
    if let running = activity ?? Activity<RecordingActivityAttributes>.activities.first {
      activity = running
      Task { await running.update(content) }
      return true
    }
    do {
      activity = try Activity<RecordingActivityAttributes>.request(
        attributes: RecordingActivityAttributes(kind: kind),
        content: content,
        pushType: nil
      )
      return true
    } catch {
      return false
    }
  }

  /// Ends every indicator of Wispra: the one of this run, and one left by a run that was killed
  func hide() {
    let all = Activity<RecordingActivityAttributes>.activities
    activity = nil
    guard !all.isEmpty else { return }
    Task {
      for running in all {
        await running.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
