import AppIntents

@available(iOS 16.0, *)
struct LogFoodInKinetta: AppIntent {
    static var title: LocalizedStringResource = "Log food in Kinetta"
    static var description = IntentDescription("Open your private food chat with text ready to review and send.")
    static var openAppWhenRun: Bool = true
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
    @Parameter(title:"Food") var food: String
    func perform() async throws -> some IntentResult {
        try NativeFoodEntryCenter.shared.add(text:food,source:.shortcut)
        return .result()
    }
}
@available(iOS 16.0, *)
struct KinettaFoodShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent:LogFoodInKinetta(),phrases:["Log food in \(.applicationName)"],shortTitle:"Log food",systemImageName:"fork.knife")
    }
}
