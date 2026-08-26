import Foundation

public enum RepNumberParser {
    private static let singleWords: [String: Int] = [
        "zero": 0,
        "one": 1,
        "won": 1,
        "two": 2,
        "to": 2,
        "too": 2,
        "three": 3,
        "four": 4,
        "for": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
        "ate": 8,
        "nine": 9,
        "ten": 10,
        "eleven": 11,
        "twelve": 12,
        "thirteen": 13,
        "fourteen": 14,
        "fifteen": 15,
        "sixteen": 16,
        "seventeen": 17,
        "eighteen": 18,
        "nineteen": 19,
    ]

    private static let tensWords: [String: Int] = [
        "twenty": 20,
        "thirty": 30,
        "forty": 40,
        "fifty": 50,
        "sixty": 60,
        "seventy": 70,
        "eighty": 80,
        "ninety": 90,
    ]

    public static func tokens(in text: String) -> [String] {
        text.lowercased()
            .replacingOccurrences(of: "-", with: " ")
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }

    /// Returns the last spoken number in the transcript. In rep mode this is the
    /// current rep ordinal, not an increment instruction.
    public static func lastNumber(in text: String) -> Int? {
        let words = tokens(in: text)
        var latest: Int?
        var index = 0

        while index < words.count {
            let word = words[index]

            if let numeric = Int(word) {
                latest = numeric
                index += 1
                continue
            }

            if word == "one",
               index + 1 < words.count,
               words[index + 1] == "hundred"
            {
                var value = 100
                if index + 2 < words.count,
                   let remainder = singleWords[words[index + 2]],
                   remainder < 20
                {
                    value += remainder
                    index += 1
                }
                latest = value
                index += 2
                continue
            }

            if let tens = tensWords[word] {
                var value = tens
                if index + 1 < words.count,
                   let ones = singleWords[words[index + 1]],
                   ones > 0,
                   ones < 10
                {
                    value += ones
                    index += 1
                }
                latest = value
                index += 1
                continue
            }

            if let value = singleWords[word] {
                latest = value
            }
            index += 1
        }

        return latest
    }

    public static func containsDone(in text: String) -> Bool {
        let commandWords: Set<String> = ["done", "finished"]
        return tokens(in: text).contains { commandWords.contains($0) }
    }
}
