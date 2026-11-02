# Age-rating worksheet — owner review required

Use the current questionnaire for the exact submitted build and services. Apple calculates the rating; these proposed answers do not promise its result. Kinetta’s account policy is16+, with a separate18+ requirement for Kit. If Apple calculates a lower global rating, select its higher-age override to16+; keep any higher required regional rating. This follows Apple’s [rating instructions](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) and [current category definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/), checked 2 November 2026.

| Question/category | Proposed answer and reason |
| --- | --- |
| Made for Kids | No. The service’s minimum age is16. |
| Parental controls | No. Ordinary privacy, block and AI settings are not a parent-managed restriction system. |
| Age assurance | Owner review: signup requires a16+ declaration; Kit additionally requires18+ consent and rejects a recorded birth year indicating under18. There is no government-ID check or Apple Declared Age Range integration. Describe this as self-declaration, not verified identity. Evidence: `app/signup.py`, `app/ai_access.py`, `app/static/app.js`. |
| User-generated content | Yes: activity titles/photos, profiles, comments and shared recipes. |
| Social media | Yes: the Activity feed, profiles, cheers and comments. |
| Social media disabled for under13 | Do not claim Apple’s specialized age-API category. Kinetta’s16+ signup declaration is different from integrating that API. |
| Messaging and chat | Yes conservatively: people can communicate through activity comments/public posting. Kit is AI conversation, not a human friend; include its behavior in the content review. |
| Advertising | No. No ad network or paid placements are integrated. |
| Unrestricted web access | Owner/native review required. Recipe source links and external links must be tested in the final app: if their browser lets a person continue to arbitrary pages inside the app, answer Yes. If they always leave for the separate system browser, verify that behavior before answering No. A fixed recipe importer alone is not an unrestricted browser. Do not change link behavior merely to lower the rating. |
| Health or wellness topics | Yes: calorie logging, food/weight summaries, training plans and exercise recommendations are regular features. |
| Medical or treatment information | Proposed None for the intended product: it does not provide diagnosis or treatment. Review the enabled Kit outputs and actual user content before confirming; the disclaimer alone does not prove every AI answer is suitable. |
| Profanity/crude humor | Owner review, proposed Infrequent/Mild rather than a claim that user text can never contain it. Check the final moderation/filter/report tools and enabled Kit behavior; Terms 2026-11-01-v1, Report/Block and the text filter are implemented; submission acceptance remains separate. |
| Alcohol/tobacco/drug references | Owner review, proposed Infrequent/Mild: food names can include alcoholic drinks; the app does not promote substance use. Assess the submitted app’s user content and AI behavior. |
| Horror/fear; mature/suggestive themes; sexual content/nudity; graphic sexual content | Intended None; owner confirms against final user-content moderation and enabled AI. Fictional screenshot data alone is not evidence of all possible content. |
| Cartoon/fantasy violence; realistic violence; prolonged graphic/sadistic violence; weapons | Intended None; same final content review applies. |
| Contests | Yes, fitness challenges and segment leaderboards. Select the applicable frequency for how prominently the submitted app offers them; regular challenges can require Frequent. No monetary prizes are promised. |
| Gambling, simulated gambling, loot boxes | No. No money wagering or randomized purchases. |

Record the final answers and Apple’s global/regional results in the release record. Keep16+ as a minimum; do not lower an18+ result or assert that the Kit opt-in automatically changes Apple’s app-wide rating. A higher result is an owner release decision, with the exact cause documented.
