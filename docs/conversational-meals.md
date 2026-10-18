# Describe what you ate

In **Nutrition → Add food**, tap **Describe, Snap or Scan**, or **My Recipes → Describe
what you ate**. Type the way you'd tell a friend:

- “2 eggs and toast for breakfast”
- “a bowl of the chili I made Sunday”
- “230 grams of the pasta I cooked on Monday for lunch”
- “half the lasagna and a diet coke last night”

Kinetta splits the sentence into foods and looks each one up in **your own records only**: saved Meals, Saved
combinations, My foods, and foods you've logged in the last year. Then you can keep talking:

- “make it 300 grams”, “make the toast 2 slices”, “two”, “only half” change an amount
- “also a coffee” adds a food; “remove the toast” or “no coke” takes one off
- “for dinner” or “it was yesterday” changes where it's logged

Each food shows its amount and calories. Tap a food for **Half** / **Double**, or ✕ to remove it. Nothing is logged
until you tap **Add to …**.

## How amounts are worked out

- **No amount** means your usual amount: what you logged last time (“as last time”).
- **A number** means that many of the unit you used before: “2 eggs” when you log eggs by the serving, “2 diet cokes”
  when you log them by the can. A different unit means that many of your usual portion.
- **Grams, ounces, kilograms, pounds** use the meal's stored weight, or the food's per-100 g values. If Kinetta doesn't
  know a food's weight it says so and asks for a count instead.
- **Half, a quarter, three quarters** of a saved meal are shares of the whole thing. “Half a serving” is half your
  usual portion.
- **A bowl / a plate / a serving** of a saved meal is the portion you logged last time. The first time you log a meal
  that's measured by weight, it asks, with one-tap **All of it / Half / A quarter**.

## Dates

“Last night”, “this morning”, “yesterday”, a weekday or 2026-10-12 say **when you ate**, and set the day (and meal)
it's logged on. Next to a cooking word (“the chili I **made** Sunday”, “pasta **from** Monday”) a date picks **which
saved meal** you mean, by the day it was saved in your time zone.

## Names

Matching ignores capitals, accents and plurals (taco/tacos). Names with “and”, “with” or numbers (“Mac and cheese”,
“5 bean chili”) are recognised as one food. If a word matches several foods, you choose. If nothing matches, the food
is **not** guessed:

- First, Kinetta checks USDA and Open Food Facts for branded products containing every requested name/brand word. Choose a candidate, check the package and serving, then confirm its amount. No generic substitute is silently logged. Coverage and catalog accuracy vary; search or scan the barcode if the exact product is missing. Database failures retain Search and Retry options.
- With AI access and consent, tap **Estimate with AI** (or **Use an AI estimate instead**). Only the words of the foods that weren't found (for example “a hot dog”) go to the AI
  estimator, and its estimate is shown as **AI estimate**, editable, in the same list. Later corrections about that
  food go to the AI as well. Your saved foods, recipes and history are never sent.
- With AI off, the food gets a **Search for “…”** button. After you add the rest, Add food opens on Search with those
  words filled in.

A photo still goes to the AI estimator with whatever you say about it.

## Cost and AI being optional

Looking things up is fixed SQL and arithmetic: **zero model calls**, no embeddings, no new dependency. It works with no
AI access and no AI consent, so food logging keeps working if AI is turned off or later sold separately
(`app/ai_access.py` gates only the estimator). With AI access and consent, unknown everyday foods are estimated automatically (one request for all of them); a named brand offers database products to pick first. Without AI, unknown foods offer the closest plain database foods and Search. Public product queries contain the unknown food words, never saved recipes or account details. Photos and later corrections to an estimate use the existing estimator.

## Safety

The resolve endpoint is authenticated and read-only; it takes your words plus the conversation so far (the server
keeps nothing between messages), never a user ID, SQL or nutrition. Confirmation requires `confirm: true`, re-reads
every food under lock from your own rows, checks each item's 15-minute fingerprint (an edited meal must be looked at
again) and calculates the nutrition on the server. Each logged entry gets a client ID derived from the confirmation,
so a retry after a lost answer returns the same entries, even if the meal was edited or deleted in between. No schema
change.

## Edit saved food

Open **Nutrition → My Recipes & foods · edit or create**. Recipe rows have a visible **Edit** button for ingredients, weight and totals; My foods has its own **Edit** buttons. Tapping the row still logs a portion. Nutrition’s help icon links to **Me → Body & heart rate** for weight, height, birth year and sex.

## Quick logging sessions

Open Log food now to type naturally, or use Snap, Photo library, Scan or Paste. Each
visit starts fresh, without reopening the previous conversation or composer draft.
Already logged food stays in Nutrition. Create a Recipe builds a reusable recipe
instead; log a portion separately from My Recipes. The
keyboard's microphone can dictate into the same text box. Send stores the message
on this device before attempting upload. New entries use Today when sent, even
when opened from Yesterday’s Nutrition view or an older dated link. That day is kept,
including after an offline delay. Pending messages remain visible with Retry or
Cancel across visits, and each server/account has its own outbox. The current
visit can use its visible foods as correction context; it does not silently select
a hidden food from the previous visit. Server-side history remains private and
exportable; starting fresh does not delete saved food.

Ready items are logged automatically unless Food chat settings requires a tap.
Uncertain food offers one source/portion question; Enter numbers remains available
without AI. Cards retain source/estimate labels and their inferred meal/day. Edit
uses the shared food editor; Undo removes that card's food. Deleting message text
keeps already logged food. Clearing the app's local storage deletes unsent messages.
Photos kept for pending uploads are removed from the on-device outbox after
processing or cancellation, and do not appear in server conversation history.

Your usuals, My Recipes and Search use the established shared pickers. Their new food entries appear as ordinary cards in the same conversation, without
pretending you typed a message. The optional daily note follows separately; this interface
alone does not establish the private tester's one-week switch acceptance.

A list or recipe portion is saved together with its conversation card. Retrying an
interrupted save does not add the food twice; a retry after Undo cannot bring it
back. Deleting only the message keeps food in the food log and does not restore
the message when an old upload retries. Pending portions stay visible in the
phone’s pending-items banner until they are accepted or discarded.

Corrections remember the food visible when you began typing, including after a
draft reload or an offline delay. If that card disappeared, choose one of your
logged foods. A changed held preview refreshes its numbers and asks you to tap Log
again; it does not save changed numbers in the first tap.

When separately enabled after evaluation, food advice, reassurance and day reviews offer an optional Kit answer. Tap Ask Kit to request it; history reads and page opens never call a model. Kit sees the current question and authenticated food tools, not your stored Health, body, weight, workouts or the deterministic burn summary. It labels its interpretation and shows verified food records and limits. Review proposed meal opens the shared portion/meal confirmation; nothing is logged before Confirm and log food. From Me: open chat, Send a question, Ask Kit (three taps plus typing); a proposed meal adds Review and Confirm (five total). An incomplete/unknown nutrient prevents a full total or unsupported meal suggestion. The saved answer remains in private server history, while reopening quick log starts a fresh view; a lost confirmation acknowledgement reuses its proposal. Physical iPhone behaviour and qualitative answer accuracy remain separate checks.

Daily note is off in Food chat settings. Choose Code summary to get a saved note when visiting chat after 8 pm in your account's time zone, or tap Daily note earlier. It states when the numbers were calculated, and later food stays in the live log. Supportive/Just the numbers also applies to the note. Code summary + optional Kit adds a separately requested richer version when evaluated AI access and consent allow it. It can be attempted only once per local day, including a failed request; refresh, toggling and deleting do not create extra attempts. Nothing is pushed to your phone and no food or target changes. Turning Off stops future notes; old notes remain individually deletable/exportable. From Me, chat → Settings → select mode → Save enables the setting (four taps plus native selector choice); once enabled, chat → Daily note is two taps from Me.

The daily Kit cap also covers requests for older notes made on the same current local day. A separate durable local-day counter survives message/reply deletion; existing UTC service/provider budgets still apply independently.

Picker receipts are opt-in for food logged from the conversation. Ordinary day-view
adds and copies do not create chat messages. Restoring a deleted item relinks the
restored food to its original conversation card without creating a second card.
A completed server save stays successful even if a phone cannot redraw its card.
When an earlier correction target was removed, the conversation offers up to five
recent foods to choose from, preserving the requested correction.
