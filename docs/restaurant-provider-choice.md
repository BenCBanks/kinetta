# Restaurant nutrition provider decision (#122 P, step 1)

Checked 17 October 2026. **Decision pending; no integration or account has been created.** This comparison covers published information, not a negotiated licence, API availability test or legal opinion.

Recommendation: obtain written coverage/rights confirmation and a quote from both providers before selecting one. Nutritionix is the stronger candidate to evaluate first for US restaurant menus; FatSecret is appealing for beta cost if its written agreement permits Kinetta's permanent food history and conversational use. Neither is approved here.

| Question | FatSecret Platform | Nutritionix / Syndigo |
|---|---|---|
| US restaurant coverage | Official search docs show branded restaurant items, including a chain example. Per-chain completeness, current menus and component-level data need a trial. [Search docs](https://platform.fatsecret.com/docs/v1/foods.search) | Publishes a restaurant dataset of roughly203,000 items across860 restaurants. This is the provider's marketing count, not a verified US-chain acceptance result. [Database](https://www.nutritionix.com/database) |
| Access and published cost | Basic: free, US data,5,000 calls/day. Premier Free: verified eligible startups, US data and advertised unlimited calls; eligibility includes revenue and funding each below$1m. Business pricing is quoted by market. Confirm the applicable rate/usage agreement. [Editions](https://platform.fatsecret.com/api-editions) | Public free access has ended. Commercial evaluation needs a sales-arranged limited trial. No verified current public price or production quota is available from the developer landing page. [Developer access](https://developer.nutritionix.com/) |
| Caching and durable logs | Default rules require refreshing/removing most content within24hours; the indefinitely storable list contains identifiers, not nutrient snapshots. Premier advertising mentions caching; obtain written terms for permanent logs, derived totals, export, shared recipes and Health writes. [Storage rules](https://platform.fatsecret.com/docs/guides/storable-data), [terms §1.5](https://platform.fatsecret.com/terms) | API retention/caching and rights to keep logged nutrient snapshots need a written agreement. Separately advertised bulk licensing allows local storage; that is not permission under an ordinary API plan. [Bulk licensing](https://www.nutritionix.com/database) |
| Display and attribution | Free plans require attribution. Policy covers content screens, a public location, website and store listing. Required attribution must survive stopping API use. Confirm the selected plan's exact requirements. [Attribution](https://platform.fatsecret.com/attribution), [terms §1.3](https://platform.fatsecret.com/terms) | Confirm attribution, restaurant branding, public display, screenshots and retained-log requirements in the offered licence; do not assume none. |
| Commercial hosting and AI | Default terms require generally accessible applications beyond development, bind certain app uses to provider terms and prohibit diet/nutrition/health advice or guidance. Conversational logging, recommendations and model/tool access need written clarification before integration. A free tier alone grants no exemption. [Terms §§1.2,1.6,1.7](https://platform.fatsecret.com/terms) | Commercial trials are offered, but the signed licence must cover hosted paid/free users, conversational retrieval and allowed downstream uses. Clarify inference versus training, provider retention and subprocessors. An app privacy notice is not an API licence. [Access](https://developer.nutritionix.com/) |
| API fit | Branded food search and serving identifiers are documented; trial restaurant matching, actual nutrient coverage and required edition. [Search](https://platform.fatsecret.com/docs/v1/foods.search) | Instant search plus item lookup supports branded items. Detailed nutrients/serving mass can require an add-on. Verify restaurant filters and all eight required nutrients in a trial. [API guide](https://docx.syndigo.com/developers/docs/nutritionix-api-guide) |
| Reliability | Paid editions advertise an SLA; free access does not establish a production uptime guarantee. No Kinetta latency/outage test has been run. [Editions](https://platform.fatsecret.com/api-editions) | Official docs link a status service. Obtain the contractual SLA, support, burst limits and outage history; no Kinetta availability measurement has been run. [API guide](https://docx.syndigo.com/developers/docs/nutritionix-api-guide) |

## Capacity assumptions for quotes

These are scenarios, not an adoption forecast. Assume two restaurant lookups per person/day, each using three debounced search requests plus one detail request, without relying on caching rights.

| Scenario | People | Calls/day | Calls/30days |
|---|---:|---:|---:|
| Small beta | 5 | 40 | 1,200 |
| Initial launch | 100 | 800 | 24,000 |
| Growth scenario | 1,000 | 8,000 | 240,000 |

The growth scenario exceeds Basic's published daily limit. Request prices for all three scenarios, peak requests/second, add-ons, overages and a hard quota/spend cap. Eligible Premier Free could cost$0 for the documented data tier; this is conditional, excludes unquoted add-ons and does not resolve retention/AI rights. Nutritionix beta/launch costs remain **unknown**, not free or an invented monthly price.

## Acceptance before selecting a provider

1. Owner obtains the offer and confirms eligibility, currency, total beta/launch cost, renewal/termination and limits.
2. Provider confirms the specific chains/menu items to test and permission to retain source-labelled logged snapshots, derived totals, owner export, Health writes and deliberately shared recipes, including after termination.
3. Written terms settle caching/display/attribution, conversational inference/tool access, restrictions on recommendations, training prohibition, commercial hosting and self-hosted-key use.
4. Owner selects the provider, creates its account and accepts its terms. Only then implement integration; credentials remain in server settings.

No email or sales form has been sent. No trial has been requested, terms accepted or spend authorized by this document.

## Implementation after approval

Search sends only restaurant/item search words: no account identifier, full conversation, dates, Health records or body data. Both Search and Describe offer licensed menu results first, with restaurant, serving and required attribution. Keep published values/source; portion changes use arithmetic, and unknown components remain unknown. Never silently substitute an AI estimate for a licensed result.

Per-person/shared quota controls, timeouts and a circuit breaker keep manual logging available. Missing results offer explicitly labelled restaurant estimates with existing consent, or Quick numbers without AI. Retention/caching follows the signed agreement rather than copying a public cache indiscriminately. Add the actual recipient and attribution to privacy/third-party docs only when integrated. No restaurant-site/app scraping.

Use recorded fictional provider responses for found/not-found/quota/outage tests, then verify licensed chain matches with the approved trial. Required later evidence includes conversational restaurant-first selection, source-preserving edits, privacy review and phone screenshots. **This step-1 PR does not claim the integration is complete.**
