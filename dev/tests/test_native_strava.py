"""Native contract checks; no Apple devices, credentials, file contents or network."""
from pathlib import Path
import plistlib
import unittest
ROOT=Path(__file__).resolve().parents[2]
APP=ROOT/'mobile/ios/App/App'
class NativeStravaContract(unittest.TestCase):
    def test_document_registration_and_cold_warm_routes(self):
        info=plistlib.loads((APP/'Info.plist').read_bytes())
        self.assertEqual(info['CFBundleDocumentTypes'][0]['LSItemContentTypes'],['public.zip-archive'])
        self.assertEqual(info['CFBundleDocumentTypes'][0]['LSHandlerRank'],'Alternate')
        self.assertTrue(info['LSSupportsOpeningDocumentsInPlace'])
        scene=(APP/'SceneDelegate.swift').read_text()
        self.assertIn('connectionOptions.urlContexts where context.url.isFileURL',scene)
        self.assertIn('URLContexts where context.url.isFileURL',scene)
        self.assertIn('URLContexts.filter { !$0.url.isFileURL }',scene)
    def test_background_and_account_fences(self):
        transfer=(APP/'NativeStravaTransfer.swift').read_text()
        self.assertIn('URLSessionConfiguration.ephemeral',transfer)
        self.assertIn('self.uploads.uploadTask',transfer)
        self.assertNotIn('self.legacy.uploadTask',transfer)
        self.assertNotIn('self.legacy.dataTask',transfer)
        self.assertIn('uploadTask(with:request,fromFile:file)',transfer)
        self.assertIn('X-Kinetta-Account',transfer)
        self.assertIn('completionHandler(nil)',(APP/'StravaImportState.swift').read_text())
        self.assertIn('transitions.accepts(stamp)',transfer)
        self.assertIn('copyQueue.async',transfer)
        self.assertIn('StravaRedirectGuard, URLSessionDataDelegate',transfer)
        self.assertIn('copyCancellation?.cancel()',transfer)
        self.assertIn('row.confirmed',transfer)
        self.assertIn('self.credential == who',transfer)
        self.assertIn('row.owner == who.owner',transfer)
        self.assertNotIn('path:path+"/confirm"',transfer)
        self.assertIn('handleEventsForBackgroundURLSession',(APP/'AppDelegate.swift').read_text())
        self.assertIn('registerPluginInstance(KinettaStravaImportPlugin())',(APP/'HealthBackgroundSync.swift').read_text())
    def test_protected_storage_and_explicit_confirmation(self):
        store=(APP/'StravaImportStore.swift').read_text()
        for value in ('isExcludedFromBackup = true','completeFileProtectionUntilFirstUserAuthentication','kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly','stopAccessingSecurityScopedResource','NSFileCoordinator','read(upToCount:1024*1024)'):
            self.assertIn(value,store)
        self.assertNotIn('kSecAttrAccessGroup',store)
        native=(APP/'NativeStravaImport.swift').read_text()
        self.assertIn('UIDocumentPickerViewController(forOpeningContentTypes:[.zip]',native)
        self.assertIn('UIAlertAction(title:"Upload"',native)
        self.assertIn('self.version == stamp,self.bound == session',native)
        self.assertIn('discardInbox',native)
    def test_unsigned_draft_check_has_no_release_actions(self):
        workflow=(ROOT/'.github/workflows/strava-native.yml').read_text()
        self.assertIn('CODE_SIGNING_ALLOWED=NO',workflow)
        self.assertNotIn('workflow_dispatch:',workflow)
        self.assertNotIn('ASC_KEY',workflow)
        self.assertIn('contents: read',workflow)
        self.assertIn('tests/strava-store/main.swift',workflow)
        project=(ROOT/'mobile/ios/App/App.xcodeproj/project.pbxproj').read_text()
        for value in ('StravaImportState','StravaImportStore','NativeStravaTransfer','NativeStravaImport'):
            self.assertEqual(project.count(value+'.swift in Sources'),2)
if __name__=='__main__':unittest.main()
