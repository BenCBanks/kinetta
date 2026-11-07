"""Offline App Store field and disclosure checks; no Apple requests or credentials."""
import json, plistlib
from pathlib import Path
from urllib.parse import urlparse
ROOT=Path(__file__).resolve().parents[1]
fields=json.loads((ROOT/'appstore/listing-en-US.json').read_text())
limits={'name':30,'subtitle':30,'promotional_text':170,'description':4000,'keywords':100,'whats_new':4000}
for name,limit in limits.items():
    value=fields[name]
    assert value and value==value.strip() and len(value)<=limit,(name,len(value),limit)
    print(f'{name}: {len(value)}/{limit} PASS')
for name in ('support_url','marketing_url','privacy_url','eula_url'):
    url=urlparse(fields[name]);assert url.scheme=='https' and url.hostname=='kinetta.app' and not url.query and not url.fragment,name
assert all('[' in fields[name] for name in ('whats_new','copyright')),'Keep owner placeholders explicit'
assert '<' not in fields['description'],'Description is plain text'
manifest=plistlib.loads((ROOT/'ios/App/App/PrivacyInfo.xcprivacy').read_bytes())
rows={r['NSPrivacyCollectedDataType'].removeprefix('NSPrivacyCollectedDataType'):r for r in manifest['NSPrivacyCollectedDataTypes']}
assert len(rows)==len(manifest['NSPrivacyCollectedDataTypes']),'Duplicate category'
assert {'EmailAddress','DeviceID','Contacts','OtherDataTypes','OtherDiagnosticData','SearchHistory'}<=rows.keys()
info=plistlib.loads((ROOT/'ios/App/App/Info.plist').read_bytes())
contacts_permission=info.get('NSContactsUsageDescription','').lower()
if contacts_permission:
    assert {'PhoneNumber'}<=rows.keys()
    assert rows['Contacts']['NSPrivacyCollectedDataTypeLinked'] is False
    assert rows['PhoneNumber']['NSPrivacyCollectedDataTypeLinked'] is True
    assert all(term in contacts_permission for term in ('contacts','salted','phone','stay on your phone'))
else:
    # Before native address-book access, Contacts described the linked social graph.
    assert rows['Contacts']['NSPrivacyCollectedDataTypeLinked'] is True
for name,row in rows.items():
    assert not row['NSPrivacyCollectedDataTypeTracking'],name
    if name!='Contacts': assert row['NSPrivacyCollectedDataTypeLinked'],name
for name in ('Health','Fitness','UserID','ProductInteraction'):
    assert 'NSPrivacyCollectedDataTypePurposeAnalytics' in rows[name]['NSPrivacyCollectedDataTypePurposes'],name
assert manifest['NSPrivacyTracking'] is False and not manifest['NSPrivacyTrackingDomains']
print('URLs, placeholders, privacy linking/tracking and retained Analytics declarations PASS')
