import Capacitor
import ContactMatchCore
import Contacts
import UIKit

// Reads only names and identifier fields after an explicit, explained action. Raw addresses never leave this plugin.
@objc(KinettaContactsPlugin)
class KinettaContactsPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "KinettaContactsPlugin"
    let jsName = "KinettaContacts"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hashContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc func hashContacts(_ call: CAPPluginCall) {
        guard let salt = call.getString("salt"), (32...64).contains(salt.utf8.count),
              salt.utf8.allSatisfy({
                  (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 || $0 == 95
              }) else {
            call.reject("A valid contact matching salt is required.")
            return
        }

        let store = CNContactStore()
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .notDetermined {
            store.requestAccess(for: .contacts) { [weak self] granted, error in
                guard let self else { call.reject("Contacts could not be read. Try again."); return }
                if error != nil { call.reject("Contacts could not be read. Try again."); return }
                let permission = Self.permissionName()
                guard granted || permission == "limited" else {
                    self.resolvePermission(permission, call: call)
                    return
                }
                self.readContacts(store, salt: salt, permission: permission, call: call)
            }
            return
        }

        let permission = Self.permissionName()
        guard permission == "authorized" || permission == "limited" else {
            resolvePermission(permission, call: call)
            return
        }
        readContacts(store, salt: salt, permission: permission, call: call)
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Settings could not be opened.")
                return
            }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() }
                else { call.reject("Settings could not be opened.") }
            }
        }
    }

    private func readContacts(_ store: CNContactStore, salt: String, permission: String, call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            let keys: [CNKeyDescriptor] = [
                CNContactIdentifierKey as CNKeyDescriptor,
                CNContactGivenNameKey as CNKeyDescriptor,
                CNContactFamilyNameKey as CNKeyDescriptor,
                CNContactEmailAddressesKey as CNKeyDescriptor,
                CNContactPhoneNumbersKey as CNKeyDescriptor
            ]
            let request = CNContactFetchRequest(keysToFetch: keys)
            request.sortOrder = .userDefault
            var sources: [ContactMatchSource] = []
            do {
                try store.enumerateContacts(with: request) { contact, _ in
                    let name = [contact.givenName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
                    sources.append(ContactMatchSource(
                        id: contact.identifier,
                        name: name.isEmpty ? "Contact" : name,
                        emails: contact.emailAddresses.map { String($0.value) },
                        phones: contact.phoneNumbers.map { $0.value.stringValue }
                    ))
                }
                let region = Locale.current.regionCode ?? "US"
                let batch = try ContactMatchHasher.build(salt: salt, region: region, contacts: sources)
                let result: [String: Any] = [
                    "permission": permission,
                    "contacts": batch.contacts.map { contact in
                        ["id": contact.id, "name": contact.name,
                         "hashes": contact.hashes.map { ["kind": $0.kind.rawValue, "digest": $0.digest] }]
                    },
                    "hashes": batch.hashes.map { ["kind": $0.kind.rawValue, "digest": $0.digest] },
                    "truncated": batch.truncated
                ]
                DispatchQueue.main.async { call.resolve(result) }
            } catch {
                DispatchQueue.main.async { call.reject("Contacts could not be read. Try again.") }
            }
        }
    }

    private func resolvePermission(_ permission: String, call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["permission": permission, "contacts": [], "hashes": [], "truncated": false])
        }
    }

    private static func permissionName() -> String {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if #available(iOS 18.0, *), status == .limited { return "limited" }
        switch status {
        case .authorized: return "authorized"
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        @unknown default: return "unavailable"
        }
    }
}
