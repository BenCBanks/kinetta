import Foundation
import Security

protocol ShareFoodCredentials {
    func read() throws -> ShareFoodCredential?
    func write(_ credential: ShareFoodCredential) throws
    func remove() throws
}

// The containing app and its own Share extension have this explicit access group.
// Not synchronized, not available while locked, and never copied to App Group files.
struct ShareFoodKeychain: ShareFoodCredentials {
    let accessGroup: String
    private func query() throws -> [String:Any] {
        guard !accessGroup.isEmpty,!accessGroup.contains("$(") else { throw ShareFoodFailure.unavailable }
        return [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"com.kinetta.food-share",
                kSecAttrAccount as String:"active",kSecAttrAccessGroup as String:accessGroup,
                kSecAttrSynchronizable as String:false]
    }
    func read() throws -> ShareFoodCredential? {
        var q = try query();q[kSecReturnData as String] = true;q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?;let status = SecItemCopyMatching(q as CFDictionary,&result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,let data = result as? Data,data.count <= 8192 else { throw ShareFoodFailure.unavailable }
        do { return try JSONDecoder().decode(ShareFoodCredential.self,from:data).checked() }
        catch { throw ShareFoodFailure.unavailable }
    }
    func write(_ credential: ShareFoodCredential) throws {
        let safe = try credential.checked(),q = try query(),data = try JSONEncoder().encode(safe)
        guard data.count <= 8192 else { throw ShareFoodFailure.invalid }
        let attrs: [String:Any] = [kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(q as CFDictionary,attrs as CFDictionary)
        if status == errSecItemNotFound {
            var create = q;for (key,value) in attrs { create[key] = value }
            guard SecItemAdd(create as CFDictionary,nil) == errSecSuccess else { throw ShareFoodFailure.unavailable }
        } else if status != errSecSuccess { throw ShareFoodFailure.unavailable }
    }
    func remove() throws {
        let status = SecItemDelete(try query() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ShareFoodFailure.unavailable }
    }
}
