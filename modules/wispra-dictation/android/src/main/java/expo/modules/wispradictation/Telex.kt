package expo.modules.wispradictation

/**
 * Vietnamese typing in the Telex style, the same rules as the Wispra keyboard on iPhone
 * (targets/keyboard/Telex.swift):
 * - tones: s sắc, f huyền, r hỏi, x ngã, j nặng, z removes the tone
 * - letters: aa â, aw ă, ee ê, oo ô, ow ơ, uw ư (uow ươ), dd đ, w alone ư
 * - pressing the same key again undoes it: ass → as, aaa → aa, ddd → dd, ww → w
 * The tone goes where the traditional rules put it (hòa, thủy, của, người, được, quá, già).
 */
object Telex {
  enum class Tone { NONE, ACUTE, GRAVE, HOOK, TILDE, DOT }

  data class Letter(var base: Char, val upper: Boolean)

  private val vowels: Map<Char, String> = mapOf(
    'a' to "aáàảãạ", 'ă' to "ăắằẳẵặ", 'â' to "âấầẩẫậ",
    'e' to "eéèẻẽẹ", 'ê' to "êếềểễệ", 'i' to "iíìỉĩị",
    'o' to "oóòỏõọ", 'ô' to "ôốồổỗộ", 'ơ' to "ơớờởỡợ",
    'u' to "uúùủũụ", 'ư' to "ưứừửữự", 'y' to "yýỳỷỹỵ",
  )

  /** Every Vietnamese vowel with a tone, back to its letter and tone */
  private val toned: Map<Char, Pair<Char, Tone>> = buildMap {
    for ((base, forms) in vowels) forms.forEachIndexed { i, form -> put(form, base to Tone.entries[i]) }
  }

  private val toneKeys = mapOf('s' to Tone.ACUTE, 'f' to Tone.GRAVE, 'r' to Tone.HOOK, 'x' to Tone.TILDE, 'j' to Tone.DOT)
  private val marked = setOf('ă', 'â', 'ê', 'ô', 'ơ', 'ư')

  fun isVowel(c: Char) = vowels.containsKey(c)

  private fun isLetter(c: Char): Boolean {
    val l = c.lowercaseChar()
    return l in 'a'..'z' || l == 'đ' || toned.containsKey(l)
  }

  /** The word as letters and one tone; null when it is not a word Telex can work on */
  fun parse(word: String): Pair<MutableList<Letter>, Tone>? {
    val letters = mutableListOf<Letter>()
    var tone = Tone.NONE
    for (c in word) {
      val l = c.lowercaseChar()
      val upper = c != l
      val t = toned[l]
      if (t != null) {
        if (t.second != Tone.NONE) {
          if (tone != Tone.NONE) return null
          tone = t.second
        }
        letters.add(Letter(t.first, upper))
      } else if (isLetter(c)) {
        letters.add(Letter(l, upper))
      } else {
        return null
      }
    }
    return letters to tone
  }

  /** Which letter carries the tone */
  fun tonePosition(letters: List<Letter>): Int? {
    val bases = letters.map { it.base }
    val idx = bases.indices.filter { isVowel(bases[it]) }.toMutableList()
    if (idx.isEmpty()) return null
    // In "qu" and "gi" the u and the i belong to the consonant when another vowel follows
    if (idx.size > 1 && idx[0] == 1 && ((bases[0] == 'q' && bases[1] == 'u') || (bases[0] == 'g' && bases[1] == 'i'))) idx.removeAt(0)
    if (idx.size == 1) return idx[0]
    // A vowel with a hat, a breve or a horn takes it (for ươ, the ơ)
    idx.lastOrNull { bases[it] in marked }?.let { return it }
    if (idx.size >= 3) return idx[1]
    val hasFinal = idx.last() < bases.size - 1
    return if (hasFinal) idx[1] else idx[0]
  }

  fun render(letters: List<Letter>, tone: Tone): String {
    val at = if (tone == Tone.NONE) null else tonePosition(letters)
    val out = StringBuilder()
    letters.forEachIndexed { i, letter ->
      var c = letter.base
      if (i == at) vowels[c]?.let { c = it[tone.ordinal] }
      out.append(if (letter.upper) c.uppercaseChar() else c)
    }
    return out.toString()
  }

  /** The word after typing [key] at its end */
  fun apply(word: String, key: Char): String {
    val k = key.lowercaseChar()
    val upper = key != k
    val plain = word + key
    if (k !in 'a'..'z') return plain
    val parsed = parse(word) ?: return plain
    val letters = parsed.first
    val tone = parsed.second
    val hasVowel = letters.any { isVowel(it.base) }

    toneKeys[k]?.let { t ->
      if (!hasVowel) return plain
      // The same tone again: take it off and keep the key as a letter (ass → as)
      if (tone == t) return render(letters, Tone.NONE) + key
      return render(letters, t)
    }
    if (k == 'z') {
      if (tone == Tone.NONE) return plain
      return render(letters, Tone.NONE)
    }
    if (k == 'a' || k == 'e' || k == 'o') {
      val hat = when (k) { 'a' -> 'â'; 'e' -> 'ê'; else -> 'ô' }
      val i = letters.indexOfLast { it.base == k || it.base == hat }
      if (i >= 0) {
        if (letters[i].base == hat) {
          letters[i].base = k
          return render(letters, tone) + key
        }
        // Only a vowel right before the key, or in the same vowel group, gets the hat
        if (i >= letters.size - 3) {
          letters[i].base = hat
          return render(letters, tone)
        }
      }
      letters.add(Letter(k, upper))
      return render(letters, tone)
    }
    if (k == 'w') {
      // uo, ưo, uơ → ươ
      val pair = (0 until letters.size - 1).lastOrNull { letters[it].base in "uư" && letters[it + 1].base in "oơ" }
      if (pair != null) {
        if (letters[pair].base == 'ư' && letters[pair + 1].base == 'ơ') {
          letters[pair].base = 'u'
          letters[pair + 1].base = 'o'
          return render(letters, tone) + key
        }
        letters[pair].base = 'ư'
        letters[pair + 1].base = 'ơ'
        return render(letters, tone)
      }
      val horn = mapOf('a' to 'ă', 'o' to 'ơ', 'u' to 'ư')
      val back = mapOf('ă' to 'a', 'ơ' to 'o', 'ư' to 'u')
      val i = letters.indexOfLast { horn.containsKey(it.base) || back.containsKey(it.base) }
      if (i >= 0) {
        horn[letters[i].base]?.let {
          letters[i].base = it
          return render(letters, tone)
        }
        // A w that started the word as ư, pressed again: just w (ww → w)
        if (i == 0 && letters.size == 1 && letters[0].base == 'ư') return key.toString()
        letters[i].base = back[letters[i].base] ?: letters[i].base
        return render(letters, tone) + key
      }
      // w on its own is ư
      letters.add(Letter('ư', upper))
      return render(letters, tone)
    }
    if (k == 'd' && letters.isNotEmpty()) {
      if (letters[0].base == 'd') {
        letters[0].base = 'đ'
        return render(letters, tone)
      }
      if (letters[0].base == 'đ') {
        letters[0].base = 'd'
        return render(letters, tone) + key
      }
    }
    letters.add(Letter(k, upper))
    return render(letters, tone)
  }
}
