<p align="center">
  <picture>
    <source srcset="docs/assets/logo-dark.svg" media="(prefers-color-scheme: dark)">
    <img src="docs/assets/logo.svg" alt="Lankki" width="320">
  </picture>
</p>

<p align="center"><b>Private fitness and food tracking for you and your people.</b><br>
Runs, rides, walks, training plans and a food log, on a server you own.</p>

---

Lankki takes its name from a Finnish word for a jog around the block: a loop, and a link in a chain. We adapted it
into our own name, a nod to moving regularly and staying connected with your people.

It started as one family's replacement for Strava and a food-tracking app. Everything stays on a computer you
control, each person's data is private to them, and nothing is sold, shared or used for ads.

## What it does

**Activities**
- Upload FIT, GPX or TCX files, or your whole Strava export, with duplicates detected automatically
- Automatic sync from Garmin (through the free [intervals.icu](https://intervals.icu)) and Apple Watch (through the iPhone app Health Auto Export)
- Maps, splits, pace, heart rate, elevation, heart-rate zones, effort score and VO2max estimate
- Matched routes: the same loop recognised automatically, with your pace on it over time
- Personal records, race predictions, a fitness/fatigue/form chart, goals, gear mileage and a heatmap
- Training plans for 5K, 10K, half marathon and marathon, from first-timer to advanced

**Food**
- Search (USDA + Open Food Facts), barcode scanning, quick add, your own foods, meals and recipes
- Optional photo logging: an AI estimate you check before it's saved
- Calories and macros against your targets, a weight trend and a running calorie deficit

**For your people**
- Each person has their own private account; the first account is the admin
- Invite someone with a link: they pick their own username and password
- Works on any phone as an app on the home screen, also offline for logging food
- Optional AI coach notes (your own Gemini or Claude key; off by default)
- Optional read-only SQL access to your own data, if you like digging into numbers

## Install it

You need a computer that stays on: a mini PC, an old laptop, a NAS (Synology, Unraid) or a Raspberry Pi 4/5 with
**[Docker](https://docs.docker.com/get-docker/)** installed. Then, in a terminal:

```sh
git clone https://github.com/BenCBanks/lankki.git
cd lankki
docker compose up -d
```

(No git? Download the ZIP from the green **Code** button on GitHub, unzip it, and run `docker compose up -d` inside the folder.)

Open **http://&lt;that computer's address&gt;:8790** in a browser and create your account. You are the admin.
Lankki makes up its own database passwords on the first start; there is nothing to fill in.

**Next: reach it from your phone.** Phones need a secure `https://` address for the camera (barcodes, food photos)
and to add Lankki to the home screen. **[docs/connect.md](docs/connect.md)** walks you through the easy options
(Tailscale for a family, a free Cloudflare Tunnel for a public address, or your own domain).

**Then: invite your people.** Me → Account → People → *Create invite link*, and text them the link.

### Settings (optional)

Copy `.env.example` to `.env`, fill in what you want, and run `docker compose up -d` again:

| Setting | What it does |
|---|---|
| `TZ` | Your time zone, e.g. `Europe/Helsinki`. New accounts use their phone's time zone. |
| `LANKKI_PORT` | The port Lankki listens on (default `8790`). |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | Turns on AI coach notes and food-photo estimates, billed to your own key. |
| `FDC_API_KEY` | Better US food search ([free key](https://fdc.nal.usda.gov/api-key-signup.html)). |
| `CLOUDFLARE_TUNNEL_TOKEN` | A public https address, see [docs/connect.md](docs/connect.md). |

### Updating

```sh
cd lankki
git pull
docker compose up -d --build
```

Your data is kept. Database changes are applied automatically when the new version starts.

### Backups

Your data lives in Docker volumes. A full copy of the database, to keep somewhere safe:

```sh
docker compose exec -T db pg_dump -U postgres -Fc fit > lankki-$(date +%F).dump
```

Restore it into a fresh install with `docker compose exec -T db pg_restore -U postgres -d fit --clean --if-exists < lankki-<date>.dump`.
Uploaded original files (FIT/GPX) are in the `data` volume.

## Privacy

- In the app, every person sees only their own activities, food and weight. Every request is checked against the
  logged-in person, and the database enforces the same rule with row-level security.
- Nothing is sent anywhere except what you turn on: food search sends the search words, barcode lookups the
  barcode, and the optional AI features send that person's own numbers (or food photo) to the AI provider whose key you set.
- Be honest with your people: **whoever runs the server can technically read the database**. Lankki is meant for
  people who trust each other, such as a family, friends or a running club.

## For the curious

- **Read-only SQL access** to your own data (DBeaver, pgAdmin, psql): see [docs/sql.md](docs/sql.md).
- **How it's built**: Python ([FastAPI](https://fastapi.tiangolo.com)) and PostgreSQL with PostGIS on the server; a
  plain-JavaScript phone app with no build step (`app/static/`). Database changes are numbered migrations in
  `app/db.py`. Feature checklist: [FEATURES.md](FEATURES.md).

## License

Lankki is free software under the **[GNU Affero General Public License v3.0](LICENSE)**: you may use, study, change
and share it. If you run a changed version for other people, you must offer them your changes under the same license.

Want to use Lankki in a way the AGPL doesn't allow, such as inside a closed product? Contact the author about a
commercial license.

The name **Lankki** and the Lankki logo are not covered by the code license. Please don't use them for your own
fork or product without permission.

Copyright © 2026 Ben Banks.
