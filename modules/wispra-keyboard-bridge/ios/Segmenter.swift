import Foundation

/// Cuts what is said in a listening session into short pieces at the pauses, so each piece can be
/// transcribed and typed while the user keeps talking (the words appear bit by bit). Foundation
/// only, so it is tested on its own (targets-tests/keyboard/KeyboardTests.swift).
struct Segmenter {
  /// Below this loudness (RMS of the samples, 0 to 1) it counts as silence
  var silenceLevel: Float = 0.012
  /// A pause this long ends a piece…
  var pauseToCut: TimeInterval = 0.7
  /// …once the piece is at least this long
  var minPiece: TimeInterval = 1.2
  /// A piece never grows longer than this, pause or not
  var maxPiece: TimeInterval = 12

  private(set) var pieceLength: TimeInterval = 0
  private(set) var silentFor: TimeInterval = 0
  /// Something above the silence level was heard in this piece
  private(set) var heardVoice = false

  /// Feeds one buffer of audio; true when the piece should end after it
  mutating func feed(level: Float, duration: TimeInterval) -> Bool {
    pieceLength += duration
    if level >= silenceLevel {
      heardVoice = true
      silentFor = 0
    } else {
      silentFor += duration
    }
    if pieceLength >= maxPiece { return true }
    return heardVoice && silentFor >= pauseToCut && pieceLength >= minPiece
  }

  mutating func reset() {
    pieceLength = 0
    silentFor = 0
    heardVoice = false
  }

  /// The loudness of float samples, as the root mean square
  static func level(_ samples: UnsafePointer<Float>, count: Int) -> Float {
    guard count > 0 else { return 0 }
    var sum: Float = 0
    for i in 0..<count { sum += samples[i] * samples[i] }
    return (sum / Float(count)).squareRoot()
  }
}
