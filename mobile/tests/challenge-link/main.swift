import Foundation

func expect(_ expected: NativeWebLinkRoute?, _ value: String, _ label: String) {
    let actual = NativeWebLink.resolve(URL(string: value))
    precondition(actual == expected, "\(label): expected \(String(describing: expected)), got \(String(describing: actual))")
}

expect(.init(path: "/challenge/AbC_123-xyz", server: "https://login.kinetta.app"),
       "https://login.kinetta.app/challenge/AbC_123-xyz", "challenge universal link is queued for the app")
expect(.init(path: "/challenge/AbC_123-xyz", server: "https://login.kinetta.app:8443"),
       "https://login.kinetta.app:8443/challenge/AbC_123-xyz?source=invite", "challenge link retains server and path, not query")
expect(.init(path: "/add/friend_code", server: "https://login.kinetta.app"),
       "https://login.kinetta.app/add/friend_code", "friend links remain supported")
expect(.init(path: "/card/award_code", server: "https://login.kinetta.app"),
       "https://login.kinetta.app/card/award_code", "card links remain supported")
expect(nil, "http://login.kinetta.app/challenge/AbC_123-xyz", "insecure scheme rejected")
expect(nil, "https://login.kinetta.app/challenge/a%2Fb", "encoded path separators rejected")
expect(nil, "https://login.kinetta.app/challenge/invalid.code", "unsupported challenge code character rejected")
expect(nil, "https://user:password@login.kinetta.app/challenge/AbC_123-xyz", "credential-bearing URL rejected")
expect(nil, "https://login.kinetta.app/challenge/", "empty challenge code rejected")
precondition(NativeWebLink.pendingChallengeRoute("/challenge/AbC_123-xyz") == "/challenge/AbC_123-xyz",
             "challenge preview survives push unregister during sign-in")
precondition(NativeWebLink.pendingChallengeRoute("/activity/42") == nil,
             "non-challenge pending routes are cleared during sign-in")
precondition(NativeWebLink.pendingChallengeRoute("/challenge/bad.code") == nil,
             "malformed challenge routes are not retained")

print("Native web link routing: challenge, friend, card and invalid URL cases PASS")
