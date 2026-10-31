import Foundation

func check(_ url: String?, _ edit: String?, _ expected: String?) {
    precondition(NativeNotificationPath.resolve(url: url, editURL: edit) == expected)
}
check(nil, nil, nil)
check(nil, "/activity/42?edit=1", nil)
check("/activity/42", nil, "/activity/42")
check("/activity/42", "/activity/42?edit=1", "/activity/42?edit=1")
check("/activity/42", "/activity/43?edit=1", "/activity/42")
check("/activity/42", "/activity/42?edit=2", "/activity/42")
check("/activity/42", "/activity/42?edit=1&next=/me", "/activity/42")
check("/activity/42", "https://example.invalid/activity/42?edit=1", "/activity/42")
check("/activity/42", "/activity/42?edit=1#other", "/activity/42")
check("/activity/0", "/activity/0?edit=1", "/activity/0")
check("/activity/-1", "/activity/-1?edit=1", "/activity/-1")
check("/activity/42\n", "/activity/42\n?edit=1", "/activity/42\n")
check("/activity/friends/42", "/activity/friends/42?edit=1", "/activity/friends/42")
check("/me/friends", "/activity/42?edit=1", "/me/friends")
check("/me/milestones", nil, "/me/milestones")
print("Native notification destination: legacy fallback, matching Edit, malformed/unrelated override rejection PASS")
