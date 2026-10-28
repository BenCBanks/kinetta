<p align="center">
  <picture>
    <source srcset="docs/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
    <img src="docs/assets/logo.svg" alt="Kinetta" width="320">
  </picture>
</p>

<p align="center"><b>Your workouts and your food, in one app.</b><br>
Activity tracking + food and health: runs, rides, walks, lifting, training plans, calories and macros. Private by design.</p>

<p align="center"><a href="https://login.kinetta.app/beta">Join the beta</a> · <a href="https://kinetta.app">kinetta.app</a></p>

---

Kinetta is a made-up word: *kinetic*, for the energy of moving every day, and *kin*, for the people you move with.

It started as one family's replacement for Strava and a food-tracking app. Each person's data is private to them,
and nothing is sold, shared or used for ads.

## What it does

**Activities**
- Upload FIT, GPX or TCX files, or your whole Strava export, with duplicates detected automatically
- Automatic sync of new Garmin activities after your watch syncs (Garmin Connect, through Garmin's developer program), and Apple Watch workouts (Apple Health in the iPhone app, or Health Auto Export). Import older history from a Strava export or Apple Health; Garmin Starter access does not include history ([details](docs/garmin-history.md))
- Maps, splits, pace, heart rate, elevation, heart-rate zones, effort score and VO2max estimate
- Matched routes: the same loop recognised automatically, with your pace on it over time
- Personal records, race predictions, a fitness/fatigue/form chart, goals, gear mileage and a heatmap
- Training plans for 5K, 10K, half marathon and marathon, from first-timer to advanced
- Lifting: log exercises, sets, reps and weight as you go, with last time beside every set; records and a history for each exercise

**Food**
- Search (USDA + Open Food Facts), barcode scanning, quick add, your own foods, meals and recipes
- Optional photo logging: an AI estimate you check before it's saved
- Calories and macros against your targets, a weight trend and a running calorie deficit

**For your people**
- Each person has their own private account; the first account is the admin
- Invite someone with a link: they pick their own username and password
- Works on any phone as an app on the home screen, also offline for logging food
- Optional AI coach notes and food estimates (off until you turn them on)
- Optional read-only SQL access to your own data (including every lifting set), if you like digging into numbers

## Run a development copy

For contributors: a throwaway copy on your own machine for testing changes. You need
**[Docker](https://docs.docker.com/get-docker/)**.

```sh
git clone https://github.com/BenCBanks/kinetta.git
cd kinetta
KINETTA_PORT=8798 docker compose -p kinettatest up -d --build
```

Open **http://localhost:8798**; the first account you create is the administrator. Optional settings go in `.env`
(copy `.env.example`): `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` turns on AI features, `FDC_API_KEY` improves US food
search. Load made-up demo data with `dev/demo/seed.py` (see [dev/demo/README.md](dev/demo/README.md)), run the tests
with `dev/tests/run.sh`, and remove the copy with `docker compose -p kinettatest down -v`. See [AGENTS.md](AGENTS.md)
for how changes are made.

## Privacy

- In the app, every person sees only their own activities, food and weight. Every request is checked against the
  logged-in person, and the database enforces the same rule with row-level security.
- Nothing is sent anywhere except what you turn on: food search sends the search words, barcode lookups the
  barcode, and the optional AI features send that person's own numbers (or food photo) to the AI provider whose key you set.
- Be honest with your people: **whoever runs the server can technically read the database**. Kinetta is meant for
  people who trust each other, such as a family, friends or a running club.

## For the curious

- **Developing in VS Code and releasing server/iPhone/database changes**: see [the update guide](docs/development-and-updates.md).
- **Read-only SQL access** to your own data (DBeaver, pgAdmin, psql): see [docs/sql.md](docs/sql.md).
- **How it's built**: Python ([FastAPI](https://fastapi.tiangolo.com)) and PostgreSQL with PostGIS on the server; a
  plain-JavaScript phone app with no build step (`app/static/`). Database changes are numbered migrations in
  `app/db.py`. Feature checklist: [FEATURES.md](FEATURES.md).

## License

Kinetta is **source-available** under the **[PolyForm Noncommercial License 1.0.0](LICENSE)**:

- **Free for noncommercial use.** Use it, study it, change it and share it for noncommercial purposes. Charities, schools and other noncommercial organizations may use it too.
- **Not for commercial use without a license.** Selling it, offering it as a paid or hosted service, or using it in or
  for a business needs a commercial license from the author. Ask about one by opening an issue or through kinetta.app.

Versions published before October 11, 2026 (up to commit `69a0169`) were released under the GNU AGPL-3.0, and copies of
those versions stay under that license. Everything after that is under the PolyForm Noncommercial License.

The name **Kinetta** and the Kinetta logo are not covered by the code license. Please don't use them for your own
fork or product without permission.

Copyright © 2026 Ben Banks.

Fixed courses and moderation: [segments](docs/segments.md).

Website writing: [edit Markdown copy without changing layouts](docs/website-content.md). Apple Watch maps: [requirements and troubleshooting](docs/apple-watch-routes.md).
