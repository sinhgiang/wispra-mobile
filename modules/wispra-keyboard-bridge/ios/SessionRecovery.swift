import Foundation

/// Keeping the listening session going (T-0178, point 3). The microphone can only be started by the app
/// while it is open, so once it runs it must not be lost: a phone call, Siri, an alarm, another app taking
/// the audio, headphones plugged in or out all stop the engine, and the session then looked alive (the beat
/// went on) while nothing was heard. These are the rules for starting it again; the audio calls themselves
/// are in KeyboardSession.swift.
enum SessionRecovery {
  /// AVAudioSession.InterruptionType: began = 1, ended = 0
  static let interruptionBegan: UInt = 1
  static let interruptionEnded: UInt = 0

  /// An interruption is over: start the engine again (whether or not iOS says resuming is "appropriate",
  /// a dictation session should come back)
  static func shouldRestart(interruptionTypeRaw: UInt) -> Bool {
    interruptionTypeRaw == interruptionEnded
  }

  /// How long to wait before the next try after a start failed (2 s, 4 s, 8 s, 16 s, 30 s, 30 s); nil when
  /// it has been tried enough: the session is then reported over, so the keyboard asks the app to start one
  /// While another app has the audio, the way back is tried this often, with no limit but the session's own
  /// time: a call or a video can last longer than the six tries below, and must not end the session
  static let interruptedRetrySeconds: TimeInterval = 3

  static func retryDelay(attempt: Int) -> TimeInterval? {
    guard attempt >= 0, attempt < 6 else { return nil }
    return min(30, 2 * pow(2, Double(attempt)))
  }
}
