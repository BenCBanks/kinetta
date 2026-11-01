# Community terms and text checks

The service terms in `site/content/terms.md` were approved by the owner on 1 November 2026. They refer to the
operator already identified in the Privacy Policy, retain the approved 24-hour report-review promise and add no
jurisdiction clause. They do not replace the source licence or Apple's standard app licence. This implementation
is not legal advice. Acceptance remains inactive until the operator enables the exact published version for a
compatible app/server release. Apple's Guideline 1.2 calls for
filtering, reporting with timely responses, blocking and contact information; it does not set a numeric 24-hour
limit or prescribe a signup checkbox. The checkbox is an explicit agreement choice for Kinetta.

## Publishing approved wording

1. The owner reviews the complete document and fills every `[OWNER: ...]` placeholder.
2. Set its `status` section to `Published`, assign a new version whenever the published wording changes, and run
   `python3 dev/design/build_content.py`. This generates the public page and `app/terms_document.json` together.
3. Publish the reviewed page and compatible app/server code. Set `KINETTA_TERMS_VERSION` to that exact version only
   when the owner is ready to put it into force. Blank leaves acceptance inactive. Startup rejects a draft or a
   mismatched version; the generator keeps a document with owner placeholders marked as a draft.

Existing accounts see a sheet after a version change. Your data opens Settings, where download and deletion stay
available. Returning to another page brings back the sheet. Acceptance records the current version and server time
in that account's private profile row; accepting the same version again keeps its original time. Signup and invite
creation require that version once enabled. Old installed clients need the compatible app update to create an
account after activation. AI, adult confirmation and Health permissions remain separate.

## Filtering and moderation

`app/community_filter.json` is a small original list, maintained in this repository; no dependency, AI call or
external text service is used. Matching ignores case, accents and zero-width format characters, recognises the
listed leetspeak substitutions and at most three punctuation/space separators between letters, and permits ordinary
English inflections. Whole-word boundaries avoid matching inside longer ordinary words. Usernames also check a
numeric disambiguation suffix. The submitted text is rejected with a plain message; it is never silently rewritten.
The list cannot recognise every threat, hateful message, impersonation, spam campaign or image. Human report review
and blocking are still necessary.

Checks cover public names/usernames/bios, comments, shared activity titles/types and visible descriptions, shared
recipe names, published segment names/descriptions and retained shared-route publication compatibility. Challenge
titles come from fixed templates, not arbitrary supplied text. Private notes, private recipes and Only-me activities
are exempt. An owner's private comments are checked before their activity becomes shared. Import items with disallowed
public text fail with a reason; the activity's text or audience is not silently changed. A hidden description is
checked when a sharing change would expose it, including changes to inherited defaults.

Reports from profiles, activities, comments, shared recipes and challenges use the existing admin queue. New recipe
review exposes the shared name only; revoking sharing leaves the submitted name snapshot, never a later private
rename. Stop sharing removes recipient access while preserving the private recipe. Challenge review exposes only its
generated title; removing it removes the group, not anyone's workouts or food. Existing versioned, explicit admin
confirmation and action receipts still apply. Reporting and blocking do not require accepting terms first.

References: [Apple UGC guideline](https://developer.apple.com/app-store/review/guidelines/#user-generated-content),
[custom licence choice](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-a-custom-license-agreement),
[Apple standard licence](https://www.apple.com/legal/internet-services/itunes/stdeula/).
