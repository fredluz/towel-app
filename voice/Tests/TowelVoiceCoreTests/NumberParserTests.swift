import Testing
@testable import TowelVoiceCore

@Test func parsesLatestSpokenOrdinal() {
    #expect(RepNumberParser.lastNumber(in: "one two three four five six seven") == 7)
    #expect(RepNumberParser.lastNumber(in: "1, 2, 3, 4, 8") == 8)
}

@Test func preservesPreviousMeaningWhenDoneHasNoNumber() {
    #expect(RepNumberParser.lastNumber(in: "done") == nil)
    #expect(RepNumberParser.containsDone(in: "Okay, done.") == true)
}

@Test func handlesCommonRepRecognitionHomophones() {
    #expect(RepNumberParser.lastNumber(in: "won too three for five six seven ate") == 8)
}

@Test func parsesCompoundNumbers() {
    #expect(RepNumberParser.lastNumber(in: "nineteen twenty twenty one") == 21)
    #expect(RepNumberParser.lastNumber(in: "one hundred twelve") == 112)
}
