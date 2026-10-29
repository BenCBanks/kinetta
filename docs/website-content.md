# Editing the website

The website's written headings, paragraphs and simple lists live in **`site/content/*.md`**, one file per page.
For example, edit [the homepage copy](../site/content/index.md) on GitHub using its pencil button. Change the prose
below a `## section-key` heading; keep the keys. Markdown supports **bold**, *emphasis*, `code` and links.
Commit the edit through a pull request. When it merges, GitHub Pages automatically builds and publishes the content.
These website-only edits do not require an iPhone build or database change.

HTML layout stays in `site/templates/`; generated ready-to-serve pages stay in `site/`. Do not edit generated prose
in `site/index.html`, because the next publication will replace it. Navigation/control labels, image captions that
contain styled spans, screenshot descriptions and metadata remain in templates; ask for a layout/metadata change
or edit the template when changing these. The feature guide's how-to entries remain sourced from the app catalog
in `app/static/explore.js`, so website and app cannot silently disagree.

Preview locally with:

```sh
python3 dev/design/build_content.py
python3 -m http.server 8080 --directory site
```

Open `http://localhost:8080`. The build requires Python 3 and Node.js, with no package installation. It validates
section keys, escapes raw HTML, allows safe local/web/mail links and refreshes the public feature catalog. CI also
builds the content, and every Pages publish runs the builder. Screenshots continue refreshing through their existing
separate workflow. Changing a screenshot does not change the written Markdown.

## Beta requests and contact email

Join beta opens hosted `/signup`, which offers account creation, the waitlist or clear invitation instructions according to the server’s current policy. A full open-signup server continues to the waitlist. Transient metadata or invitation failures show Retry and preserve the intended card, friend or challenge link. Account access and TestFlight installation access are separate. The waitlist itself is `/beta`. Requests enter the separate `/admin` portal's Beta requests queue; submission itself sends no email and creates no account. An administrator can preview a response, then explicitly send it through the configured Resend adapter. Sending stays unavailable until a verified sender, monitored reply-to address, API key and signed webhook are configured. See [administration](admin-portal.md).

The portal distinguishes queued, provider-accepted, delivered, failed/bounced and joined states. Account invitations are single-use Member links; Apple TestFlight installation access is separate. Manual invitation links explicitly say no email was sent. The confirmation and form link back to `https://kinetta.app/`.

Add the branded support address to the policy and templates once it exists. Do not guess an address or claim delivery from a form submission or provider acceptance alone.
