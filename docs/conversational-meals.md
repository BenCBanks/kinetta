# Describe what you ate

In **Nutrition → Add food**, tap **Describe or snap** (or **Describe it** when AI is off), or **My meals → Describe
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

- With AI access and consent, only the words of the foods that weren't found (for example “a hot dog”) go to the AI
  estimator, and its estimate is shown as **AI estimate**, editable, in the same list. Later corrections about that
  food go to the AI as well. Your saved foods, recipes and history are never sent.
- With AI off, the food gets a **Search for “…”** button. After you add the rest, Add food opens on Search with those
  words filled in.

A photo still goes to the AI estimator with whatever you say about it.

## Cost and AI being optional

Looking things up is fixed SQL and arithmetic: **zero model calls**, no embeddings, no new dependency. It works with no
AI access and no AI consent, so food logging keeps working if AI is turned off or later sold separately
(`app/ai_access.py` gates only the estimator). One AI request per message at most, and only for unknown foods.

## Safety

The resolve endpoint is authenticated and read-only; it takes your words plus the conversation so far (the server
keeps nothing between messages), never a user ID, SQL or nutrition. Confirmation requires `confirm: true`, re-reads
every food under lock from your own rows, checks each item's 15-minute fingerprint (an edited meal must be looked at
again) and calculates the nutrition on the server. Each logged entry gets a client ID derived from the confirmation,
so a retry after a lost answer returns the same entries, even if the meal was edited or deleted in between. No schema
change.
